// 分阶段浏览器验收窗口（可测模块）——防旧结果复用。
//
// 协议：
//  - 每轮验收一个独立 run 目录（runId 唯一）；阶段 URL/done/截图都在其中
//  - 阶段开启即删除本阶段 done（连续第二次必须重新等待出现）
//  - done 由浏览器操作方「原子提交」：写 .tmp 后 rename 为 done；内容必须携带身份
//    { runId, phase, tgzSha256 } 且与本轮一致——旧/错身份一律 FAIL（拒绝，非跳过）
//  - screenshot 必须是本轮 run 目录内的实际非空文件（仅字符串不算）
//  - URL 文件 mode 0600（仅当前用户可读）；调用方在 run 结束时删除（不留 token）
import { existsSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export function newRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * @param {object} opts
 * @param {string} opts.runDir   本轮独立目录
 * @param {string} opts.runId
 * @param {string} opts.tgzSha256
 * @param {(name:string, ok:boolean|null, detail?:string)=>void} opts.step 结果记录器
 * @param {number} [opts.timeoutMs=240000]
 * @param {number} [opts.pollMs=500]
 */
export function makeStageWindow({ runDir, runId, tgzSha256, step, timeoutMs = 240_000, pollMs = 500 }) {
  const waitAppear = async (file, timeoutMs2) => {
    const deadline = Date.now() + timeoutMs2
    while (Date.now() < deadline && !existsSync(file)) await new Promise((r) => setTimeout(r, pollMs))
    return existsSync(file)
  }

  return async function stageWindow(phase, url, checks) {
    const urlFile = join(runDir, `stage-${phase}.url`)
    const doneFile = join(runDir, `stage-${phase}.done`)
    // 阶段开启即清旧 done：连续第二次必须重新等待（预放/残留立即失效）
    rmSync(doneFile, { force: true })
    writeFileSync(urlFile, `${url}\n`, { mode: 0o600 })
    const windowOpenedAt = Date.now()
    console.log(`STAGE_${phase.toUpperCase()}_READY url-file=${urlFile} done-file=${doneFile}（原子提交：先写 .tmp 再 rename；内容须含 runId/phase/tgzSha256 身份）`)

    const appeared = await waitAppear(doneFile, timeoutMs)
    if (!appeared) {
      step(`browser(${phase}): 浏览器阶段结果`, null, `旗标超时（${timeoutMs}ms）未出现`)
      return null
    }
    // done 必须在窗口开启之后出现（防御：等待前已存在却被删又被预放的竞态由身份校验兜底）
    const doneStat = statSync(doneFile)
    if (doneStat.mtimeMs < windowOpenedAt - 1000) {
      step(`browser(${phase}): done 出现时机非法`, false, '早于阶段窗口开启')
      return null
    }
    let result = null
    try { result = JSON.parse(readFileSync(doneFile, 'utf8')) } catch {
      step(`browser(${phase}): 结果文件解析`, false, 'JSON 非法')
      return null
    }
    // 身份绑定：旧/错身份一律拒绝
    if (result?.runId !== runId || result?.phase !== phase || result?.tgzSha256 !== tgzSha256) {
      step(`browser(${phase}): 身份校验（runId/phase/tgzSha）`, false,
        `期望 run=${runId.slice(-6)} phase=${phase} sha=${tgzSha256.slice(0, 8)}；实得 run=${String(result?.runId ?? '').slice(-6)} phase=${result?.phase ?? null} sha=${String(result?.tgzSha256 ?? '').slice(0, 8) || '无'}`)
      return null
    }
    for (const [key, ok, desc] of checks(result)) {
      // screenshot 类结果：必须为本轮 run 目录内的实际非空文件
      if (key === '截图留证') {
        const p = result.screenshot ? resolve(dirname(doneFile), String(result.screenshot)) : ''
        const inRun = p.startsWith(resolve(runDir) + '/')
        const valid = inRun && existsSync(p) && statSync(p).size > 0
        step(`browser(${phase}): ${key}`, valid, valid ? p : `截图须为本轮目录实际非空文件（得到：${String(result.screenshot ?? '').slice(0, 80) || '无'}）`)
        continue
      }
      step(`browser(${phase}): ${key}`, ok === true, desc ?? '')
    }
    return result
  }
}

export const helpers = { existsSync, readFileSync, writeFileSync, rmSync, fileURLToPath }
