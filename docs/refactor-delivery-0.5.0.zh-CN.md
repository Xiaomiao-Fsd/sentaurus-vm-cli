# Sentaurus VM CLI 0.5.0 重构交付说明

交付日期：2026-07-15

本次交付把 CLI 从单文件循环重构为状态化终端应用，并为 Sentaurus-agent 增加可由 CLI 与
Web 共用的 session workflow 协议。交互方式参考 Codex CLI 的命令、目标和规划习惯，但
Sentaurus 执行仍只发生在 CentOS worker 的 allowlist runner 内。

## 1. 交付范围

### CLI

- `ReplApp` 只负责交互编排；session、turn、附件、命令、输入和渲染分别由独立模块负责。
- 单一命令注册表同时驱动解析、`/help` 和 Tab 补全，未知 slash command 会直接报错。
- 新内联编辑器支持 Unicode grapheme、中文、历史、反向查找、多行输入和 resize reflow。
- SSE 与 polling 先归一化成同一事件模型，再输出终端 Markdown 或 JSONL。
- Markdown 流支持段落、列表、围栏代码块和表格；未闭合代码块不会被提前渲染。
- `/goal` 和 `/plan` 使用结构化 API，不依赖解析 agent 的自然语言回复。

### Sentaurus-agent

- 新增 `GET/PATCH /api/vm/agent/sessions/:sessionId/workflow`。
- workflow 包含 goal、plan、单调 revision，并按 session 持久化。
- goal 支持 `active`、`paused`、`blocked`、`complete` 生命周期。
- plan 支持 `default`/`plan` 模式和步骤状态；最多一个步骤为 `in_progress`。
- 写入使用 session 文件锁、临时文件原子替换和乐观 revision 冲突检测。
- 旧 `goals/<session>.json` 会被兼容读取，并在下一次更新时写入 workflow；原文件不删除。
- Web slash command 面板已加入 `/plan` 并更新 `/goal` 用法。

## 2. 安全边界

workflow relay 只接受受认证的 session ID、固定 action 和 JSON payload；SSH 端脚本只导入固定
路径 `~/.sentaurus-web-agent/vm-agent/agent_worker.py`，不接受用户路径或 shell 文本。

`/plan` 是 worker 端执行锁：规划 turn 即使返回合法的 `SENTAURUS_RUN_REQUEST` 或
`VM_SESSION_FILE`，worker 也不会执行仿真或发布文件。`/plan approve` 只解除锁，不会隐式
启动任何作业。批准后必须再发送一条明确的执行消息。

CLI 仍不能执行任意 SSH/shell。模型密钥留在 CentOS，VM SSH 私钥和 Web token 留在 Windows
服务主机；Sentaurus 命令仍受原有工具 allowlist、run schema 和 artifact 路径校验约束。

## 3. 升级与启动

在 `sentaurus-vm-cli` 仓库：

```powershell
npm install
npm run check
npm link
```

在 `Sentaurus-agent` 仓库构建并重启当前服务，然后部署 worker：

```powershell
npm install
npm run build
vm-agent connect
```

`connect` 会部署 worker 0.8.0，并保留 VM 的 `.env`、`AGENTS.md`、会话历史、workflow 和
仿真产物。若状态中没有 `session_workflow_v1`，交互 CLI 会要求先执行 `/connect`。

外部设备仍从 Windows SSH 入口使用：

```powershell
ssh -6 -l sshdev <host-ipv6>
vm-agent
```

## 4. 快速使用

启动后会显示 API、session、VM 状态，以及当前 goal/plan 状态。普通文本按 Enter 发送：

```text
> 检查当前器件的网格和接触设置
```

输入控制：

| 按键 | 行为 |
| --- | --- |
| `Enter` | 发送 |
| `Shift+Enter` / `Ctrl+J` | 插入换行 |
| `Tab` | 补全命令、session、模型或 workflow 动作 |
| `Up` / `Down` | 浏览输入历史 |
| `Ctrl+R` | 反向查找历史 |
| `Ctrl+A` / `Ctrl+E` | 移到开头/结尾 |
| `Ctrl+U` / `Ctrl+K` | 删除光标前/后的内容 |
| `Ctrl+C` | 清空输入；空输入退出；turn 运行时取消等待 |
| `Ctrl+D` | 空输入退出 |

输入 `/help` 查看全部交互命令，输入 `/help goal` 查看单项用法。

## 5. Goal 工作流

```text
/goal 校准 28 nm NMOS 的 Vth、SS 和 DIBL，并输出可复现数据
/goal
/goal pause
/goal resume
/goal block 缺少高漏压 Id-Vg 数据
/goal edit 使用 0.05 V 与 0.80 V 两组真实偏压完成提取
/goal complete
/goal clear
```

只有 `active` goal 会注入普通模型 turn。`paused`、`blocked` 和 `complete` 状态会持久保留，
但不会继续驱动普通 turn；`resume` 会恢复注入。

## 6. Plan 到执行

```text
/goal 修复现有 deck 并完成最小 Id-Vg 验证
/plan
检查已有附件和历史，给出分步修复与验证计划
/plan show
/plan step step-01 in_progress
/plan approve
按已批准计划执行 step-01；若输入完整则运行最小验证
```

推荐顺序是“设目标 -> 进入 plan -> 发送规划任务 -> 查看/调整步骤 -> 批准 -> 明确执行”。

- `/plan exit`：退出只读模式但保留计划，表示没有批准。
- `/plan clear`：退出并清空计划。
- `/plan step <id> pending|in_progress|completed`：更新步骤状态。
- CLI 与 Web 同时更新导致 revision 过期时，CLI 会刷新状态并要求复核后重试。

## 7. 会话、附件与模型

```text
/sessions
/new 28 nm threshold calibration
/resume run_20260715
/rename calibrated baseline
/attach "C:\TCAD Inputs\device.cmd"
/attachments
/detach 1
/files
/download 1 .\result.plt
/model list
/model gpt-5.6-sol
```

附件仍先上传到 Web run，并在可用时同步到 VM session。切换 session 会清空尚未发送的附件，
避免附件误发到另一会话。

## 8. 非交互与自动化

```powershell
vm-agent exec "检查 worker 和许可证状态"
Get-Content -Raw .\task.md | vm-agent exec -
vm-agent review --attach .\device.cmd "重点检查接触与偏压"
vm-agent exec /status --json --output .\last-response.txt
```

`--json` turn 输出是 JSONL，稳定事件包括 `session.started`、`turn.started`、`worklog`、
`response.delta`、`response.completed`、`turn.completed` 和 `error`。SSE 不可用时会自动回退
polling；两条路径使用同一个事件归一化器，不改变最终输出协议。

## 9. 兼容性与限制

- `sentaurus-vm`、`svm`、`vm-agent`、`sentaurus-vm-ssh` 四个入口保持不变。
- 顶层命令和配置路径保持兼容；CLI 版本由 0.4.1 提升到 0.5.0。
- worker 版本提升到 0.8.0；旧 worker 可继续聊天，但不支持结构化 workflow API。
- 本地 archive/delete 语义没有扩大；删除 Web run 不等于擦除 VM history/workflow/output。
- CLI 不提供 session fork、任意 provider、任意 shell 或绕过 Sentaurus runner 的入口。
- 输入历史只在当前 CLI 进程中保存，不写入磁盘。

## 10. 验收

CLI：

```powershell
npm run check
npm pack --dry-run
node .\dist\sentaurus-vm.js --version
node .\dist\sentaurus-vm.js --help
```

Sentaurus-agent：

```powershell
npm run test:codex-features
npm run typecheck
npm run build
```

自动化覆盖命令解析与补全、Unicode 输入布局、Markdown 边界、SSE/JSONL 归一化、workflow
认证与校验、goal 生命周期、plan 步骤约束、revision 冲突，以及 plan 模式下禁止执行合法
run request。完整命令参考见 [CLI 指令功能参考](cli-command-reference.zh-CN.md)。

本次交付的实际结果：

| 验收项 | 结果 |
| --- | --- |
| CLI typecheck + unit tests + build | 通过，36/36 tests |
| CLI package dry-run | 通过，0.5.0 tarball 内容 118 files |
| CLI production dependency audit | 通过，0 vulnerabilities |
| goal/plan/server/Web 专项 | 通过，15/15 tests |
| session history/files 回归 | 通过，16/16 tests |
| PLT/runner/SSH/SSE 回归 | 通过，27/27 tests |
| shared/server/Web typecheck | 通过 |
| shared/server/Web production build | 通过 |
