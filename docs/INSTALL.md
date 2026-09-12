# 安装、升级与回退

适用 DeepSeekBot 0.6.0-rc.1。本插件不是独立应用；本版验证宿主为 DSH Desktop 0.8.1 / macOS arm64。Windows、Linux和其他宿主版本尚未完成本版实机验收。源码构建需要 Node.js 22+ 和 pnpm；安装预编译包无需构建。

## 安装

1. 安装DSH，在宿主配置自己的模型服务和API key，确认普通对话成功。插件不附带额度或凭据。
2. 从GitHub Release下载 `dsh-grokbot-0.6.0-rc.1.tgz`、`SHA256SUMS`，放在同一目录。
3. 在下载目录运行：

```sh
shasum -a 256 -c SHA256SUMS
dsh plugin --profile web add ./dsh-grokbot-0.6.0-rc.1.tgz
```

若找不到dsh，先配置宿主CLI并运行 `dsh plugin --help`；不要在未知运行时目录执行npm install。使用其他profile时替换web参数。

4. 等在途任务结束后重启DSH，从侧栏或主页进入幕僚长，做一个独立试用目录中的小任务。

插件patch启用宿主bash、文件和后台任务工具；权限沿用宿主。不要给试用任务无关目录的访问权限。

## 数据、备份与升级

状态目录为当前宿主的 `$DSH_HOME/grokbot`，可由stateDir覆盖，不一定是 `~/.dsh/grokbot`；Desktop和CLI可能使用不同数据根。成员、会话、项目、成果、复盘在状态目录，原生会话另在宿主sessions目录。API key由宿主凭据系统管理。

升级前等任务结束、退出宿主，备份旧插件包、profile配置和数据目录。备份只保存在本机，不发给同事、不附在issue中。安装固定版本tgz后重启，不同时运行两个实例写相同状态。

回退时退出宿主，安装原版本包并恢复配套的升级前状态和profile备份。旧版本读取新状态不保证兼容，因此仅降级包不保证恢复。先保留本地异常现场，勿直接删数据。

## 卸载

运行 `dsh plugin --profile web remove dsh-grokbot` 后重启。卸载插件不等于删除业务数据，不要删除整个DSH根目录。不同宿主命令以其 `dsh plugin --help` 为准。

## 包完整性

Release附tgz、SHA256SUMS、manifest.json和手册。manifest记录源码提交和包内文件哈希。发布包不含个人凭据、聊天记录、node_modules、运行日志或业务项目。
