# Sentaurus VM CLI

一个参考 Codex CLI 交互方式的 Sentaurus TCAD 终端客户端。它复用
`sentaurus-web-agent` 的 Fastify API，由 Windows 主机通过 OpenSSH 桥接到
CentOS 7 VM 内的 worker；外部客户端不需要也不会取得 VM SSH 私钥、模型密钥或任意 shell 权限。

```text
External terminal
  sentaurus-vm
       |
       | HTTP(S), or HTTP inside an SSH tunnel over host IPv6
       v
Sentaurus Web Agent (Windows / Fastify :5175)
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
- 本地附件上传并同步到 VM session
- VM session 文件及 run artifact 列表与下载
- IPv4、括号形式 IPv6 URL、HTTPS 和 SSH 隧道
- token 环境变量或用户级 `0600` 配置；终端登录时隐藏输入
- `--json` 状态输出，适合脚本和监控

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
```

## 首次连接

交互保存服务地址和 token：

```powershell
sentaurus-vm login
sentaurus-vm doctor
sentaurus-vm
```

也可以只使用环境变量，不写配置文件：

```powershell
$env:SENTAURUS_VM_URL = 'http://[2001:db8::10]:5175'
$env:SENTAURUS_VM_TOKEN = '<AUTH_TOKEN>'
sentaurus-vm doctor
```

配置默认保存在 `~/.sentaurus-vm-cli/config.json`。`SENTAURUS_VM_URL` 和
`SENTAURUS_VM_TOKEN` 的优先级高于该文件；日志和 `config` 命令不会输出完整 token。

## 常用命令

```text
sentaurus-vm                         进入交互模式
sentaurus-vm chat "检查 VM 工具状态"  单次提问
sentaurus-vm resume <session-prefix> 恢复会话
sentaurus-vm sessions                列出会话
sentaurus-vm status                  查看 worker 状态
sentaurus-vm doctor                  检查 API/auth/SSH/worker/tools
sentaurus-vm connect                 部署并重启 VM worker
sentaurus-vm new "研究标题"          新建会话
sentaurus-vm files --session <id>    列出会话文件
sentaurus-vm download <path> ...     下载会话文件
sentaurus-vm artifact <run> <path>   下载 run artifact
```

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

## IPv6 外部访问

服务端监听和 Windows 防火墙配置见 [docs/ipv6-deployment.md](docs/ipv6-deployment.md)。

仓库附带管理员脚本，可将后端注册为系统启动触发、异常重启的 Windows S4U 计划任务：

```powershell
.\scripts\install-windows-server-task.ps1
```

公网 IPv6 上直接使用 `http://` 会以明文传输 bearer token。可信网络可以用于临时验收；
跨公网长期使用应配置 TLS，或仅开放主机 SSH 并建立本地端口转发：

```powershell
# 在外部机器上执行，保持该进程运行
ssh -N -L 5175:127.0.0.1:5175 <windows-user>@<host-ipv6>

$env:SENTAURUS_VM_URL = 'http://127.0.0.1:5175'
$env:SENTAURUS_VM_TOKEN = '<AUTH_TOKEN>'
sentaurus-vm doctor
```

这条路径仍满足完整链路：外部 CLI 经主机 IPv6 SSH 进入 Fastify 服务，Fastify 再经
`sentaurus-centos7` SSH alias 连接 VM worker。

## 安全边界

- CLI 只调用已存在的受认证 Web API，不提供任意 SSH/shell 命令入口。
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
