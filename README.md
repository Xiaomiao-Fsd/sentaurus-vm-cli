# Sentaurus VM CLI

一个参考 Codex CLI 交互方式的 Sentaurus TCAD 终端客户端。它复用
`sentaurus-web-agent` 的 Fastify API，由 Windows 主机通过 OpenSSH 桥接到
CentOS 7 VM 内的 worker；外部客户端不需要也不会取得 VM SSH 私钥、模型密钥或任意 shell 权限。

```text
External terminal
  ssh sshdev@<host-ipv6>
       |
       | Windows OpenSSH (public TCP 22)
       v
Windows PowerShell
  vm-agent
       |
       | loopback HTTP + host-local token
       v
Sentaurus Web Agent (Windows / Fastify [::1]:5175)
       |
       | OpenSSH alias: sentaurus-centos7
       v
CentOS 7 VM worker
       |
       +-- VM-local LLM configuration
       +-- allowlisted sde / sprocess / sdevice / inspect runner
       +-- session files, logs, plots, and artifacts
```

## 功能

- Codex 风格的持续对话、会话新建和恢复
- SSE 增量回复、worklog/仿真进度、并发会话隔离
- `/goal`、`/side`、`/status`、`/tools` 等 VM worker 命令透传
- `doctor`、`status` 和 `connect` 完整检查/部署 SSH worker 链路
- `vm-agent` 主机模式自动启动 Web 服务并按需唤醒 worker，不要求用户输入 token
- 本地附件上传并同步到 VM session
- VM session 文件及 run artifact 列表与下载
- IPv4、括号形式 IPv6 URL、HTTPS、SSH 登录和 SSH 隧道
- token 环境变量或用户级 `0600` 配置；终端登录时隐藏输入
- `--json` 状态输出，适合脚本和监控
- Codex 风格 `exec`：stdin、JSONL 事件流、`--output` 最终回复落盘和临时会话
- Sentaurus 专用 `review`，以及会话重命名、归档、取消归档和确认删除
- `-C/--cd`、`-i/--image` 与 PowerShell/Bash/Zsh/Fish 命令补全
- 五模型白名单切换、固定 `max` 推理，以及非 GPT-5.6 272k / GPT-5.6 353k 上下文策略

## 环境要求

- Node.js 20.12 或更高版本
- 一个可访问的 `sentaurus-web-agent` 服务
- 服务主机能执行 `ssh sentaurus-centos7` 并连接 CentOS 7 VM
- 服务端 `.env` 中已设置至少 24 字符的非默认 `AUTH_TOKEN`

CLI 不直接执行 Sentaurus 命令。所有仿真仍由 VM worker 的 allowlist 和安全边界控制。

## 安装

从 GitHub 安装：

```powershell
npm install --global https://github.com/Xiaomiao-Fsd/sentaurus-vm-cli.git
sentaurus-vm --version
```

在源码仓库开发：

```powershell
npm install
npm run check
npm link
.\scripts\install-ssh-entry.ps1
.\scripts\install-windows-server-task.ps1
```

## 推荐：SSH 登录后直接进入 CLI

外部设备先登录 Windows 主机：

```powershell
ssh -6 -l sshdev <host-ipv6>
```

进入主机 PowerShell 后只需执行：

```powershell
vm-agent
```

`vm-agent` 会在 Windows 主机内部完成：定位 `Sentaurus-agent` 仓库、读取本地 `.env`、
启动/等待 Fastify 服务、通过 `sentaurus-centos7` SSH 检查 CentOS 7 worker、仅在 worker
未运行时执行 `connect`，最后进入交互会话。token 不需要传给外部设备，也不会出现在命令行。

单次执行也可以使用同一个固定命令：

```powershell
vm-agent /status
vm-agent "检查当前 Sentaurus 工具和许可证状态"
```

仍可使用 `sentaurus-vm login`/`SENTAURUS_VM_TOKEN` 连接独立或远端 API，但这不是 SSH
主机模式的必需步骤。

## 常用命令

```text
sentaurus-vm                         进入交互模式
vm-agent                            SSH 主机内自动引导并进入交互模式
vm-agent exec /status               非交互执行一轮任务
vm-agent exec - --json              从 stdin 读取并输出 JSONL
vm-agent review --attach deck.cmd   审查 Sentaurus deck
vm-agent models                     查看模型库和当前模型
vm-agent model gpt-5.6-sol          切换模型并重启 VM worker
sentaurus-vm chat "检查 VM 工具状态"  单次提问
sentaurus-vm resume <session-prefix> 恢复会话
sentaurus-vm sessions                列出会话
sentaurus-vm archive <session>       本地归档会话
sentaurus-vm completion powershell  生成 PowerShell 补全
sentaurus-vm status                  查看 worker 状态
sentaurus-vm doctor                  检查 API/auth/SSH/worker/tools
sentaurus-vm connect                 部署并重启 VM worker
sentaurus-vm new "研究标题"          新建会话
sentaurus-vm files --session <id>    列出会话文件
sentaurus-vm download <path> ...     下载会话文件
sentaurus-vm artifact <run> <path>   下载 run artifact
```

完整的指令、选项、JSONL 事件和 Codex CLI 移植对照见
[VM Agent CLI 指令功能参考总览](docs/cli-command-reference.zh-CN.md)。

交互模式输入 `/help` 可查看本地命令。没有被本地处理的 slash command 会原样发送给
VM worker，因此 `/goal`、`/side`、`/status`、`/tools` 等行为与 Web UI 一致。

附件示例：

```powershell
sentaurus-vm chat --attach .\device.cmd "审阅并运行这个 deck"
```

或在交互模式中：

```text
/attach "C:\TCAD Inputs\device.cmd"
请检查接触、网格和物理模型，然后运行最小验证。
```

## IPv6 SSH 外部访问

服务端监听和 Windows 防火墙配置见 [docs/ipv6-deployment.md](docs/ipv6-deployment.md)。

仓库附带管理员脚本，可将后端注册为系统启动触发、异常重启的 Windows S4U 计划任务。
默认 SSH-only 模式会禁用 API 的公网防火墙规则：

```powershell
.\scripts\install-windows-server-task.ps1
```

外部只需连接主机 SSH 22，随后运行 `vm-agent`，不需要转发 5175。若外部程序确实需要
直接调用 API，可显式使用 `-PublicApi` 重新开放防火墙，但必须同时配置 TLS。

```powershell
.\scripts\install-windows-server-task.ps1 -PublicApi
```

公网 IPv6 上直接使用 `http://` 会明文传输 bearer token，因此默认不开放。

## 安全边界

- CLI 只调用已存在的受认证 Web API，不提供任意 SSH/shell 命令入口。
- SSH-only 主机模式仍保留服务端 token；它由 launcher 在主机内读取，作为纵深保护。
- VM SSH key 只保留在 Web 服务主机；VM 的 LLM 凭据只保留在 CentOS 7。
- `connect` 会更新 worker 程序文件并重启 worker，但保留 VM 内 `.env`、配置、历史和产物。
- 文件路径、扩展名、大小和 artifact 路径继续由 Web 服务与 worker 校验。
- 不要提交 `~/.sentaurus-vm-cli/config.json`、服务端 `.env` 或任何私钥。

## 开发验证

```powershell
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

项目使用 Node 原生 `fetch`、SSE、`readline` 和 `FormData`，运行时没有第三方依赖。

## License

MIT
