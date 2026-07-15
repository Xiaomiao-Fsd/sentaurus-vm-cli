# Sentaurus VM CLI 0.7.0 Session 恢复说明

交付日期：2026-07-15

## 1. 全量 Session 选择框

在交互终端执行：

```powershell
vm-agent resume --all
```

CLI 获取全部 Web runs，包括本地归档项，并原地显示选择框：

```text
+- Select a session (3) ------------------------------------------+
|>   排查 SDevice 牛顿迭代不收敛          created  2m ago          |
|    优化 MOSFET 网格参数                  created  1d ago          |
|  A 比较两组 Id-Vg 曲线                   created  2026-07-10      |
|Up/Down select | Enter resume | Esc cancel                       |
+----------------------------------------------------------------+
```

| 按键 | 行为 |
| --- | --- |
| `Up` / `Down` | 移动选中项；长列表自动滚动 |
| `Home` / `End` | 跳到第一项或最后一项 |
| `Enter` | 恢复选中 session 并进入原有交互流程 |
| `Esc` / `Ctrl+C` / `Ctrl+D` | 取消，不修改上次 session |

默认选中 `lastSessionId`；没有可匹配记录时选中最近更新的 session。标题是主信息，状态、
更新时间和短 ID 是辅助信息。重名标题始终附加短 ID；归档项显示 `A`，选择后仍保持归档。
选择框支持终端 resize、窄宽度截断、有限可见窗口和 `NO_COLOR` ASCII 选中标记。

## 2. 精确触发边界

选择框只在以下条件同时成立时启用：

- 命令是直接交互调用的 `resume --all`；
- 没有显式 session 参数，也没有 `--last`；
- stdin 和 stdout 都是 TTY；
- 没有使用 `--json` 或 `exec resume`。

因此以下既有形式不变：

```powershell
vm-agent resume
vm-agent resume <id-prefix>
vm-agent resume "Exact title"
vm-agent resume --last
vm-agent exec resume --last "/status"
```

非 TTY 和自动化环境不会等待方向键输入。

## 3. 首问临时标题

没有传入标题的新 session 初始标题是 `New session`。当第一条非 slash 用户消息被服务端接受后，
CLI 在本地生成简短标题，并调用已有的 run title API 保存。该操作不增加模型请求，不向对话
历史插入隐藏消息，也不等待 agent 完成回复。

示例：

```text
首问：我想请你帮忙看看为什么这个 SDevice 仿真在牛顿迭代第 30 步不收敛
标题：排查 SDevice 仿真在牛顿迭代第 30 步不收敛
```

生成规则：

- 合并换行并移除 Markdown 装饰和终端控制字符；
- 去掉“请帮我”“我想请你”“Could you please”等常见开场语；
- 对“为什么……”形式使用面向任务的“排查……”标题；
- 屏蔽 Bearer token 和常见 API token 形式；
- 按终端显示宽度安全截断；纯代码首问使用 `Code task`；
- slash command 不参与标题生成。

显式 `--title`、`new <title>`、`/new <title>` 以及后续 `rename` 的标题不自动覆盖。旧 session
也不做批量回填。标题更新失败只输出弱提示，不中断已经提交的用户消息和 agent 回复。

## 4. 验收范围

自动化测试覆盖触发边界、排序、默认选中、方向键、Enter、Esc、resize、归档和重名显示、
中英文标题生成、宽度限制、敏感信息处理，以及标题更新发生在消息提交成功之后。

| 检查项 | 结果 |
| --- | --- |
| `npm run check` | 通过：类型检查、52 项测试和构建全部成功 |
| `npm pack --dry-run` | 通过：0.7.0 包含 128 个文件，包体 105.2 kB |
| `npm audit --omit=dev` | 通过：0 个已知漏洞 |
| 构建后 `--version` / `--help` / `features --json` | 通过：版本、帮助和两项新功能标记一致 |

完整命令边界见 [CLI 指令功能参考](cli-command-reference.zh-CN.md)。
