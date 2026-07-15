# VM Agent CLI 指令功能参考总览

适用版本：`sentaurus-vm-cli 0.7.0`

Codex 对照基线：本机安装的 `codex-cli 0.144.4` 实际命令帮助，核对日期为
2026-07-15。本文既是使用手册，也是 Codex CLI 能力移植清单。

## 1. 推荐入口

从外部设备登录 Windows 主机：

```powershell
ssh -6 -l sshdev <host-ipv6>
```

登录后的默认 shell 是 Windows PowerShell。推荐直接运行：

```powershell
vm-agent
```

`vm-agent` 会在主机内部定位 `Sentaurus-agent`、读取服务端 `.env`、启动或等待只监听
loopback 的 Web API、检查主机到 CentOS 7 的 SSH，并在 worker 未运行时唤醒 worker。
外部用户不需要输入、保存或看见 `AUTH_TOKEN`。

四个可执行名称：

| 名称 | 用途 |
| --- | --- |
| `vm-agent` | 推荐的 SSH 主机入口，默认启用无 token 主机引导 |
| `sentaurus-vm-ssh` | `vm-agent` 的完整别名 |
| `sentaurus-vm` | 通用客户端；默认读取用户配置或环境变量 |
| `svm` | `sentaurus-vm` 的短别名 |

`sentaurus-vm local ...` 与 `sentaurus-vm --host ...` 等价于 `vm-agent ...`。

## 2. 最常用工作流

进入持续对话：

```powershell
vm-agent
```

执行单次任务：

```powershell
vm-agent exec "检查当前 VM、Sentaurus 工具和许可证状态"
vm-agent exec /status
```

从管道读取长提示：

```powershell
Get-Content -Raw .\task.md | vm-agent exec -
Get-Content -Raw .\context.txt | vm-agent exec "结合以下补充上下文检查 deck" -
```

上传 deck 并审查：

```powershell
vm-agent review --attach .\device_des.cmd --attach .\device.cmd
vm-agent review "重点检查接触定义和漏端偏压" --attach .\device.cmd
```

恢复会话：

```powershell
vm-agent sessions
vm-agent resume --all
vm-agent resume run_20260714
vm-agent resume "Threshold calibration"
vm-agent resume --last
vm-agent exec resume --last "/status"
```

自动化调用：

```powershell
vm-agent exec /status --json --output .\last-response.txt
vm-agent doctor --json
vm-agent status --json
vm-agent models
vm-agent model gpt-5.6-sol
```

## 3. 顶层命令总览

| 命令 | 功能 | 是否访问 VM |
| --- | --- | --- |
| `chat [MESSAGE]` | 无消息时进入交互，有消息时执行一轮对话 | 是 |
| `ask MESSAGE` | 单轮提问别名 | 是 |
| `exec [PROMPT|-]` | Codex 风格非交互执行，支持 stdin、JSONL 和回复落盘 | 是 |
| `review [INSTRUCTIONS]` | 对 deck、脚本、日志和结果做 findings-first 审查 | 是 |
| `resume [SESSION] [PROMPT]` | 恢复会话；交互式 `--all` 打开选择框 | 是 |
| `new [TITLE]` | 创建并记住新会话；省略标题时由首问生成临时标题 | 否，仅 Web API |
| `sessions [--all]` | 列出活跃会话；`--all` 包括本地归档项 | 否，仅 Web API |
| `history [SESSION]` | 查看合并后的会话历史 | 是 |
| `rename SESSION TITLE` | 修改 Web run 标题 | 否，仅 Web API |
| `archive SESSION` | 在本机 CLI 配置中归档，会从默认列表隐藏 | 否，仅 Web API |
| `unarchive SESSION` | 取消本地归档 | 否，仅 Web API |
| `delete SESSION` | 确认后删除 Windows Web run 目录 | 否，仅 Web API |
| `files --session ID` | 列出 VM session 输出文件 | 是 |
| `download PATH ...` | 下载 VM session 文件 | 是 |
| `artifact RUN_ID PATH` | 下载 Sentaurus run artifact | 是 |
| `status` | 查看桥接、worker、模型和队列状态 | 是 |
| `connect` | 部署或重启 CentOS worker | 是，会改变 worker 状态 |
| `doctor` | 检查 API、认证、SSH、worker 和 Sentaurus 工具 | 是 |
| `models [--json]` | 列出五个允许模型、当前模型和上下文总量 | 是 |
| `model [list|current]` | 显示当前模型及模型库 | 是 |
| `model <NAME>`、`model set <NAME>` | 原子更新 VM 配置并重启 worker | 是，会改变 worker 状态 |
| `features` | 列出当前 CLI/host/worker 能力 | 否 |
| `completion [SHELL]` | 生成 PowerShell/Bash/Zsh/Fish 补全脚本 | 否 |
| `login` | 保存远程 API URL 和 token | 是 |
| `logout` | 删除用户配置中保存的 token | 否 |
| `config` | 显示解析后的配置，token 始终掩码 | 否 |
| `local [COMMAND]` | 显式启用 SSH 主机引导后执行任意命令 | 视子命令而定 |

会话选择器可以使用完整 ID、唯一 ID 前缀、完整标题或唯一标题前缀。标题匹配不区分大小写。

在 TTY 中执行不带 session 参数的 `vm-agent resume --all` 会打开全量选择框。列表按更新时间
降序排列并默认选中上次会话；`Up`/`Down` 移动，`Enter` 恢复，`Esc` 或 `Ctrl+C` 取消。
归档项仍可选择并显示 `A` 标记，但恢复不会修改归档状态。重名标题会显示缩短 ID 以便区分。
带 ID/标题、`--last`、`exec resume`、JSON 和非 TTY 调用继续使用原来的解析逻辑。

## 4. 模型查询与切换

```powershell
vm-agent models
vm-agent models --json
vm-agent model
vm-agent model list
vm-agent model current
vm-agent model gpt-5.6-sol
vm-agent model set gpt-5.6-terra
```

模型库是服务端和 worker 双重校验的闭集，只允许：

| 模型 | 上下文总数 | 推理等级 |
| --- | ---: | --- |
| `gpt-5.4` | 272,000 tokens | `max` |
| `gpt-5.5` | 272,000 tokens | `max` |
| `gpt-5.6-luna` | 353,000 tokens | `max` |
| `gpt-5.6-terra` | 353,000 tokens | `max` |
| `gpt-5.6-sol` | 353,000 tokens | `max` |

切换过程：

- Windows 服务端先校验模型名，未知模型返回 HTTP 400。
- VM 内只原子替换 `.env` 的 `LLM_MODEL`、`LLM_MODELS`、`LLM_API_STYLE`、
  `LLM_REASONING_EFFORT` 和模型超时，不读取或回传 API key。
- 切换后自动重新部署并重启 worker；会话历史、目标、Sentaurus 文件和凭据保留。
- `LLM_MODELS` 只保存当前所选模型，不做跨模型静默回退；失败会明确返回错误。
- Responses 请求固定发送 `reasoning.effort=max`，并默认请求 `reasoning.summary=auto`；若兼容端点拒绝该字段，worker 会审计降级并自动重试。
- CLI 只显示 provider 明确返回的摘要或 worker 根据执行状态生成的确定性摘要，不读取、传输或展示模型原始思维链。
- Id-Vg 运行的最终回复由固定 DF-ISE 提取器的结构化结果生成，包含实际漏压、有效点数、Vth、SS、DIBL、对应恒流/电压点和关键产物，不再复用运行前预期文本。
- 272k/353k 是总窗口。worker 在 85% 时压缩上下文、95% 时执行硬保护，为最终回复保留空间。

对应保护阈值：

| 模型族 | 总窗口 | 软压缩阈值 | 硬保护阈值 |
| --- | ---: | ---: | ---: |
| `gpt-5.4`、`gpt-5.5` | 272,000 | 231,200 | 258,400 |
| `gpt-5.6-*` | 353,000 | 300,050 | 335,350 |

状态行会显示类似：

```text
connected | worker running | gpt-5.6-sol max | context 353k | queue 0
```

## 5. 非交互执行

### 4.1 `exec`

```text
vm-agent exec [PROMPT|-] [OPTIONS]
vm-agent exec resume [SESSION] [PROMPT] [--last]
vm-agent exec review [INSTRUCTIONS]
```

行为：

- 参数为 `-` 时只从 stdin 读取提示。
- 已有参数时，末尾显式加 `-` 才会读取 stdin，并把内容追加为 `<stdin>...</stdin>` 块。
  这避免 SSH 远程命令把未关闭的输入通道误判成管道而等待。
- `--json` 把 stdout 切换为逐行 JSON 事件；诊断和降级提示写到 stderr。
- `--output PATH` 写入最终 agent 回复，内容与 `turn.completed.finalResponse` 一致。
- `--ephemeral` 创建临时 Web run，并在执行结束后删除该 run。
- `--timeout SECONDS` 范围是 1 到 86400，默认 1800 秒。

### 4.2 `review`

`review` 不是通用 Git code review。它把 Codex 的专用审查工作流移植成 Sentaurus 领域审查：

- 先列 findings，按严重性排序；
- 检查 deck 语法、物理模型、几何、接触、网格、偏压、收敛和结果解释；
- 尽量引用文件、行号或参数名；
- 没发现缺陷时明确说明，并列出剩余验证缺口；
- 默认不启动或重跑仿真，除非指令明确要求。

## 6. JSON 与 JSONL

`status`、`doctor`、`sessions`、`history`、`features` 等查询命令的 `--json` 输出单个 JSON 文档。

单轮聊天、`exec` 和 `review` 的 `--json` 输出 JSONL。每一行都是独立 JSON 对象，可能出现：

| `type` | 含义 |
| --- | --- |
| `session.started` | 已解析或创建会话，并取得 worker 与 workflow 状态 |
| `attachment.completed` | 一个附件已上传并完成 VM 同步或 fallback |
| `turn.started` | 本轮已开始 |
| `worklog` | planning、progress、tool/run 等折叠工作日志 |
| `reasoning.summary` | 可公开的安全推理/执行摘要，含 `stage` 与 `status` |
| `attachments` | 已发布的仿真文件和图片，含 `runId` 与结构化附件数组 |
| `response.delta` | agent 增量回复 |
| `response.completed` | agent 完整回复或流结束消息 |
| `notice` | 其它可见 agent 消息 |
| `turn.completed` | 本轮结束且始终最后发出；除最终回复外还含 `runId`、`runStatus`、`reasoningSummaries` 和 `attachments` |
| `session.deleted` | `--ephemeral` 临时 Web run 已清理 |
| `error` | 可机器读取的错误事件 |

PowerShell 消费示例：

```powershell
$events = vm-agent exec /status --json | ForEach-Object { $_ | ConvertFrom-Json }
$final = $events | Where-Object type -eq 'turn.completed' | Select-Object -Last 1
$final.finalResponse
$final.reasoningSummaries
$final.attachments
```

对于 `run_final`，CLI 会保留一个短收尾窗口接收紧随最终回复发布的产物，再输出
`turn.completed`。普通聊天回复不增加这段等待。

不要在 JSONL 模式下启动无提示的交互聊天；CLI 会要求改用 `exec`。

## 7. 会话生命周期

```powershell
vm-agent new
vm-agent new "28 nm MOSFET Id-Vg"
vm-agent resume --all
vm-agent sessions
vm-agent rename run_20260714 "28 nm MOSFET calibrated"
vm-agent archive run_20260714
vm-agent sessions --all
vm-agent unarchive run_20260714
vm-agent delete run_20260714
vm-agent delete run_20260714 --force
```

规则：

- 当前会话 ID 保存在 `~/.sentaurus-vm-cli/config.json`。
- 没有显式标题的新 session 初始显示 `New session`。第一条非 slash 用户消息被服务端接受后，
  CLI 会在本地提炼单行标题并通过现有 run 更新 API 保存；不会额外发送隐藏模型对话。
- 临时标题会去除常见请求开场语、控制字符和常见 token，并按显示宽度截断。显式标题、
  `/rename` 和 `rename` 的结果不会被自动覆盖；现有旧 session 不会批量改名。
- `resume` 不给选择器时优先恢复上次会话；`--last` 强制选择最新活跃会话。
- 只有交互式 `resume --all` 打开选择框；其它 resume 形式保持兼容。
- 归档是 CLI 本地视图元数据，不移动或删除 Web/VM 文件。
- `delete` 默认要求输入完整 session ID；非交互脚本必须显式使用 `--force`。
- 当前 `delete` 删除 Windows Web run 目录中的 manifest、上传、日志和 artifact。VM worker
  自己的历史、workflow 或 VM session 输出没有统一删除 API，因此不能把它理解为跨主机安全擦除。
- `--ephemeral` 的清理范围与 `delete` 相同。

## 8. 文件、图片和工作目录

```powershell
vm-agent exec "检查附件" --attach .\device.cmd
vm-agent exec "解释图中的异常" --image .\idvg.png
vm-agent exec "审查输入" -C C:\TCAD\case-01 --attach .\device.cmd
vm-agent files --session run_20260714
vm-agent download output.plt --session run_20260714 --category 仿真结果文件
vm-agent artifact sentaurus-run-id plots\idvg.png --output .\idvg.png
```

- `--attach` 和 `--image` 都可重复。
- PNG、JPEG、GIF、WebP、BMP 会被标记为图片附件。
- `-C/--cd` 在执行命令前切换工作目录，影响相对附件路径和输出路径。
- 下载时如果文件名不能唯一确定 category，必须传 `--category`。

## 9. 交互模式本地命令

`vm-agent` 使用稳定的 `> ` / `| ` 内联编辑器。Windows OpenSSH 会话启动 CLI 时会自动把
控制台从代码页 936 切换到 UTF-8，因此可以直接输入或粘贴中文；编辑器按 grapheme 移动，
不会从 UTF-16 代理项或组合字符中间截断中文、emoji 或组合字符。

当单行输入以 `/` 开头且光标位于末尾时，CLI 会自动显示命令提示框。候选项包含完整命令和
一行简介；输入更多字符会实时过滤。`/goal `、`/plan `、`/model ` 等会继续显示子命令，
`/resume `、`/model set ` 和 `/plan step ` 会读取当前 session、模型或计划步骤作为动态候选。

| 按键 | 行为 |
| --- | --- |
| `Enter` | 发送当前输入 |
| `Shift+Enter` 或 `Ctrl+J` | 插入换行 |
| `Tab` | 补齐提示框中当前选中的命令、子命令或动态值 |
| `Up` / `Down` | 提示框打开时切换候选；关闭时浏览输入历史 |
| `Esc` | 关闭提示框，直到输入内容再次变化；随后按 Tab 可重新打开并补齐 |
| `Ctrl+R` | 从历史中反向查找当前文本 |
| `Ctrl+A` / `Ctrl+E` | 移到输入开头/结尾 |
| `Ctrl+U` / `Ctrl+K` | 删除光标前/后的内容 |
| `Ctrl+C` | 有输入时清空；空输入时退出。turn 运行中用于取消等待 |
| `Ctrl+D` | 空输入时退出 |

终端尺寸变化会重排输入。agent 回复按当前宽度渲染 Markdown；围栏代码块会等到完整边界后再
渲染，避免流式输出期间破坏代码和表格布局。

在输入框中输入 `/help` 可查看：

| 命令 | 功能 |
| --- | --- |
| `/new [title]` | 新建并切换会话 |
| `/resume <id-prefix|title>` | 切换会话并显示历史 |
| `/rename <title>` | 重命名当前会话 |
| `/archive` | 归档当前会话并切换到其它活跃会话 |
| `/sessions [--all]` | 列出活跃或全部会话 |
| `/session` | 显示当前会话 |
| `/history` | 重新加载最近历史 |
| `/attach <path> [...]` | 上传下一轮使用的附件 |
| `/attachments` | 查看待发送附件 |
| `/detach <number|all>` | 从待发送列表移除附件 |
| `/files` | 列出当前 VM session 文件 |
| `/download <number|path> [out]` | 下载列表中的文件 |
| `/artifact <run-id> <path> [out]` | 下载 run artifact |
| `/connect` | 部署并重启 worker |
| `/model`、`/model list` | 显示当前模型和五模型库 |
| `/model <name>`、`/model set <name>` | 切换模型并重启 worker |
| `/doctor` | 快速显示 API 和桥接状态 |
| `/goal [动作]` | 通过结构化 workflow API 管理会话目标 |
| `/plan [动作]` | 通过结构化 workflow API 管理只读规划模式 |
| `/clear` | 清屏 |
| `/exit`、`/quit` | 退出 CLI |

命令来自同一个注册表，提示框、简介、帮助、解析和 Tab 补全不会各维护一份列表。`/side`、`/status`、
`/tools` 等已注册远端命令会原样发送给 VM worker；未知 slash command 会被拒绝。

## 10. Goal 与 Plan 工作流

| 命令 | 功能 |
| --- | --- |
| `/goal` | 查看当前会话的持久目标 |
| `/goal <text>` | 设置或替换目标 |
| `/goal edit <text>` | 显式编辑目标并重新激活 |
| `/goal pause` / `/goal resume` | 暂停或恢复目标注入 |
| `/goal block [reason]` | 标记阻塞并记录可选原因 |
| `/goal complete` | 标记完成；后续普通 turn 不再注入该目标 |
| `/goal clear` | 清除目标 |
| `/plan` / `/plan enter` | 进入只读规划模式 |
| `/plan show` | 显示 revision、模式和步骤状态 |
| `/plan approve` | 批准计划并解除执行锁；不会自动启动仿真 |
| `/plan exit` | 不批准地退出规划模式，保留步骤 |
| `/plan clear` | 退出规划模式并清空步骤 |
| `/plan step <id> <status>` | 更新步骤为 `pending`、`in_progress` 或 `completed` |
| `/help` | CLI 注册命令摘要；`/help goal` 可查看单项用法 |
| `/status` | worker、工具、manual 和 safe skill 状态 |
| `/side <task>` | 隔离调查，不替换主线历史和目标 |
| `/skill`、`/tools` | 查看 VM safe skills 或 Sentaurus 工具 |
| `/instance`、`/instances` | 查看 agent/simulation 实例 |
| `/sentaurus-status` | 查看 Sentaurus 专项状态 |

workflow 按 session 保存，并带单调递增的 `revision`。CLI 更新时携带期望 revision；若 Web
或另一 CLI 已先修改，服务端返回 409，CLI 刷新当前状态并要求用户复核后重试。

`/plan` 模式是 worker 端硬边界，不只是提示词：worker 不解析或执行 run request，也不发布
模型生成的 session 文件。`/plan approve` 只把 mode 切回默认模式，之后仍需一条明确执行消息。
一个计划最多 64 步，且最多一项为 `in_progress`。

普通自然语言中的“状态”“仿真”等词不会触发 slash command；必须以 `/` 开头。

## 11. Completion

当前 PowerShell 会话启用补全：

```powershell
sentaurus-vm completion powershell | Out-String | Invoke-Expression
```

持久启用时，可在 PowerShell profile 中执行同一行。其它 shell：

```bash
source <(sentaurus-vm completion bash)
source <(sentaurus-vm completion zsh)
sentaurus-vm completion fish | source
```

## 12. 全局选项

| 选项 | 说明 |
| --- | --- |
| `--host` | 主机本地引导；token 只从服务端 `.env` 读取 |
| `--url URL` | 通用/远程 API origin |
| `--token TOKEN` | 通用/远程 API token；不推荐直接写进命令历史 |
| `--session ID` | 指定会话 |
| `--last` | 使用最新活跃会话 |
| `--all` | 包括本地归档会话 |
| `--title TITLE` | 新会话标题 |
| `--attach PATH` | 附件，可重复 |
| `-i, --image PATH` | 图片附件，可重复 |
| `--timeout SECONDS` | 回复等待时间 |
| `-o, --output PATH` | 单轮最终回复文件，或下载目标 |
| `-C, --cd DIR` | 工作目录 |
| `--ephemeral` | 单轮结束后删除临时 Web run |
| `--force` | 跳过 delete 确认 |
| `--category NAME` | VM session 文件分类 |
| `--web-repo PATH` | 主机模式的 Web 仓库路径 |
| `--task-name NAME` | 主机模式的 Windows 计划任务名 |
| `--restart-worker` | 主机引导时强制重部署/重启 worker |
| `--no-history` | 交互启动时不显示历史 |
| `--json` | JSON 或单轮 JSONL |

## 13. Codex CLI 功能移植对照

| Codex 0.144.4 能力 | VM Agent CLI 状态 | 处理方式 |
| --- | --- | --- |
| 交互 TUI/chat | 已移植 | 内联 UTF-8/grapheme 编辑器、实时命令提示框、多行、历史、补全和终端 reflow |
| 流式 Markdown | 已移植 | 统一事件归一化后渲染段落、代码块、列表和表格 |
| goal 生命周期 | 已领域化移植 | session 级 active/paused/blocked/complete 状态与 revision |
| plan mode | 已领域化移植 | worker 端阻止文件发布和 Sentaurus 执行，批准不隐式运行 |
| `exec` 非交互 | 已移植 | 支持参数、stdin、JSONL、timeout |
| `exec resume --last` | 已移植 | 支持 ID/标题和最新活跃会话 |
| `review` | 已领域化移植 | 从 Git diff review 改为 Sentaurus deck/result review |
| `-i/--image` | 已移植 | 上传为 session 图片附件 |
| `-C/--cd` | 已移植 | 控制附件和输出的相对路径 |
| `--json` | 已移植 | 查询命令为 JSON，turn 为 JSONL |
| `-o/--output-last-message` | 已移植 | 使用统一的 `-o/--output` |
| `--ephemeral` | 已移植，范围不同 | 执行后删除临时 Windows Web run |
| `resume` | 已移植 | 支持 ID、前缀、标题、`--last` |
| `archive`/`unarchive` | 已移植，范围不同 | 存为当前 SSH 用户的本地 CLI 元数据 |
| `delete` | 已移植，范围不同 | 删除 Windows Web run；不声称擦除 VM worker 数据 |
| `completion` | 已移植 | PowerShell/Bash/Zsh/Fish |
| `doctor --json` | 已移植 | 检查 API、auth、SSH、worker、tools，输出不含 token |
| `features list` | 已移植 | 显示 CLI/host/worker 稳定能力，不做运行时 flag 开关 |
| `login`/`logout` | 已保留 | 仅供通用/远程 API 模式；SSH 主机模式不需要 |
| session `fork` | 未移植 | worker 没有原子历史克隆 API；用拼接提示伪造会污染历史 |
| `apply` | 不适用 | Codex 用于应用代码 diff；VM Agent 已有文件/artifact 下载 |
| Codex Cloud | 不适用 | 当前任务在用户自己的 Windows/CentOS 链路执行 |
| MCP、plugin、app-server、remote-control | 未移植 | 当前扩展边界是 VM safe skills 和 allowlisted runner |
| model 选择 | 已领域化移植 | 五模型白名单、固定 max、按模型族设置 272k/353k，并持久化到 VM |
| OSS/provider/profile | 未移植 | VM 使用固定 Responses 网关和 VM 内凭据，不开放任意 provider 注入 |
| sandbox/approval policy | 不直接移植 | VM 端固定 allowlist 比客户端可选任意 shell 更严格 |
| `--add-dir` | 不适用 | CLI 只读取用户显式传入的附件，不扫描可写工作区 |
| `--output-schema` | 未移植 | 后端没有结构化输出/schema 强制协议，不能假保证 |
| web search/browser/image generation | 未移植 | 与离线/受控 Sentaurus 执行边界无关 |

## 14. 安全边界

- `vm-agent` 不把服务端 token 写入参数、用户配置或 stdout。
- Web API 默认只监听 `[::1]:5175`；外部入口是 OpenSSH 22。
- VM SSH 私钥只留在 Windows 主机，模型凭据只留在 CentOS 7。
- CLI 不提供任意 shell；实际 Sentaurus 作业仍受 VM allowlist 和 run request schema 约束。
- `/goal` 与 `/plan` 端点只接受固定 action；SSH relay 使用固定 worker 路径和 base64 JSON。
- workflow 写入使用 session 文件锁、原子替换和 revision 冲突检测。
- 模型切换只接受固定五模型白名单，VM 配置通过原子写入更新，不允许用户提供任意 API 地址或命令。
- JSON/JSONL、`doctor` 和 `config` 都不会输出完整 token。
- 公网直接访问 HTTP API 会明文传 bearer token；需要远程 API 时应使用 TLS 或 SSH tunnel。

完整顶层帮助：

```powershell
vm-agent --help
```

交互帮助：

```text
/help
```
