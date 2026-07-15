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
- 独立显示 provider 许可或确定性执行摘要，不输出模型原始思维链
- Id-Vg 最终回复直接显示固定提取器得到的 Vth、两点法/窗口法 SS、DIBL 与对应偏压
- 仿真曲线、指标 JSON/DAT、CSV 和报告以结构化终端/JSONL 产物事件发布
- 输入 `/` 即时显示 slash command 提示框，包含一行简介、方向键选择和 Tab 补齐
- `resume --all` 提供可用方向键选择的全量 session 列表，标题优先、ID 仅作辅助
- 无显式标题的新 session 会在首条自然语言消息提交后生成临时标题
- 统一 slash command 注册表，支持 goal/plan 子命令、会话、模型和计划步骤动态候选
- `/goal` 完整生命周期，以及带执行硬锁的 `/plan` 只读规划模式
- `/side`、`/status`、`/tools` 等受支持 VM worker 命令透传
- 流式 Markdown 渲染，支持代码块、列表、表格和终端宽度重排
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
- Codex 风格内联编辑器；支持中文 grapheme、历史检索、多行输入和窗口重排
- Windows SSH 会话自动切换 UTF-8，可直接输入和粘贴中文

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
进入交互会话后，在 `> ` 提示符输入中文并按 Enter 发送；`Shift+Enter` 或
`Ctrl+J` 插入换行。输入 `/` 会立即打开命令提示框，`Up`/`Down` 选择，Tab 补齐，
`Esc` 关闭；提示框关闭时 `Up`/`Down` 仍用于浏览输入历史。

恢复会话时可以直接打开全量选择框：

```powershell
vm-agent resume --all
```

选择框默认定位到上次使用的 session；`Up`/`Down` 移动，`Enter` 恢复，`Esc` 或
`Ctrl+C` 取消。列表包含本地归档项并明确标记，但恢复归档 session 不会自动取消归档。

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
vm-agent resume --all                交互选择任意会话
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
本次重构范围、兼容性和验收记录见
[0.5.0 重构交付说明](docs/refactor-delivery-0.5.0.zh-CN.md)。
命令提示框的交互规则和验收记录见
[0.6.0 命令提示框说明](docs/command-palette-0.6.0.zh-CN.md)。
Session 选择框和首问临时标题的规则见
[0.7.0 Session 恢复说明](docs/session-resume-0.7.0.zh-CN.md)。

交互模式输入 `/help` 可查看注册命令。`/goal` 与 `/plan` 通过带 revision 的结构化 API
修改会话工作流；`/side`、`/status`、`/tools` 等注册的远端命令原样发送给 VM worker。
未知 slash command 会被 CLI 拒绝并提示 `/help`，避免拼写错误意外进入模型对话。

推荐的目标与规划流程：

```text
/goal 校准器件阈值电压，并输出可复现的 Id-Vg 结果
/plan
检查已有 deck，制定最小改动和验证步骤
/plan show
/plan approve
按已批准计划执行第一步
```

`/plan` 模式下 worker 会硬性跳过文件发布和 `SENTAURUS_RUN_REQUEST` 执行。`/plan approve`
只解除执行锁，不会自行启动仿真；批准后仍需发送明确的执行消息。

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
- 工作流端点只接受固定 action 与 session ID，不接受 VM 路径或 shell；revision 冲突返回 409。
- 不要提交 `~/.sentaurus-vm-cli/config.json`、服务端 `.env` 或任何私钥。

## 开发验证

```powershell
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

网络和协议层使用 Node 原生 `fetch`、SSE 与 `FormData`；终端渲染使用 `marked`、
`marked-terminal` 和 `string-width`。运行时依赖已锁定在 `package-lock.json`。

## License

MIT
