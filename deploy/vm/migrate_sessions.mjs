// 迁移会话头：把首帧 header JSON 里的 Mac 工作区路径重写为 VM 路径。
// 逐帧解压 → 仅改首帧 → 带校验和逐帧重压缩（与 DSH 帧格式一致）。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync, constants } from 'node:zlib'

const MAC = '/Users/moltbot/Library/Application Support/dsh-desktop/harness/grokbot'
const VM = '/home/bot/dsh-home/grokbot'
const ZSTD_MAGIC = 4247762216

function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('bad magic @' + offset)
    offset += 4
    const d = buffer.readUInt8(offset); offset += 1
    const csf = d >>> 6, ss = (d & 32) !== 0, ck = (d & 4) !== 0, df = d & 3
    const db = df === 3 ? 4 : df
    const cb = csf === 0 ? (ss ? 1 : 0) : 1 << csf
    offset += (ss ? 0 : 1) + db + cb
    for (;;) {
      const bh = buffer.readUIntLE(offset, 3); offset += 3
      const last = (bh & 1) !== 0, bt = (bh >>> 1) & 3, bs = bh >>> 3
      offset += bt === 1 ? 1 : bs
      if (last) break
    }
    if (ck) offset += 4
    frames.push([start, offset])
  }
  return frames
}

const CHECKSUM = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
const root = process.argv[2]
let fixed = 0
for (const proj of readdirSync(root, { withFileTypes: true })) {
  if (!proj.isDirectory()) continue
  const pdir = join(root, proj.name)
  for (const sid of readdirSync(pdir, { withFileTypes: true })) {
    if (!sid.isDirectory()) continue
    const p = join(pdir, sid.name, 'session.jsonl.zstd')
    let buf
    try { buf = readFileSync(p) } catch { continue }
    let frames
    try { frames = scanFrames(buf) } catch (e) { console.log('SKIP(帧错误)', p, e.message); continue }
    let changed = false
    const out = []
    for (const [s, e] of frames) {
      const fb = buf.subarray(s, e)
      const plain = zstdDecompressSync(fb)
      const text = plain.toString('utf8')
      if (!changed && text.includes(MAC)) {
        const patched = text.split(MAC).join(VM)
        out.push(zstdCompressSync(Buffer.from(patched, 'utf8'), CHECKSUM))
        changed = true
      } else {
        out.push(fb)
      }
    }
    if (changed) {
      writeFileSync(p, Buffer.concat(out))
      fixed += 1
    }
  }
}
console.log(`完成：${fixed} 个会话头已重写 ${MAC} → ${VM}`)
