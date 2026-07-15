# Sentaurus VM CLI 0.6.0 命令提示框说明

交付日期：2026-07-15

## 1. 使用方式

在交互 session 的空输入中键入 `/`，提示框会立即出现：

```text
> /g
+- Commands ----------------------------+
|> /goal  View or update the durable ...|
+---------------------------------------+
```

不需要先按 Tab。继续输入会实时过滤候选项。

| 按键 | 行为 |
| --- | --- |
| `Up` / `Down` | 循环选择提示框候选项 |
| `Tab` | 用选中项替换当前输入；需要下一级参数时自动追加空格并继续提示 |
| `Esc` | 关闭当前提示框，输入发生变化后自动重新打开 |
| `Enter` | 发送当前输入，不会隐式接受候选项 |
| `Left` / `Home` | 光标离开输入末尾时隐藏提示框 |

提示框关闭或没有候选项时，`Up` / `Down` 保持原来的输入历史浏览行为。Esc 关闭后直接按
Tab，会重新打开候选并补齐第一项。

## 2. 多级与动态候选

以下层级会继续提示：

```text
/goal <show|set|edit|pause|resume|block|complete|clear>
/plan <show|enter|approve|exit|clear|step>
/plan step <step-id> <pending|in_progress|completed>
/model <list|current|set|model-id>
/model set <model-id>
/resume <session-id>
/help <command>
```

session ID、模型 ID 和 plan step ID 取自当前 `ReplApp` 状态，因此切换 session、模型或更新
计划后，下一次打开提示框会使用最新候选。

## 3. 布局规则

- 提示框和输入行作为一个整体原地重绘，不向 scrollback 反复追加候选。
- 提交输入前会清除提示框，只保留最终 `> command` 输入行。
- 默认最多显示 8 个候选，方向键移动时窗口跟随选中项。
- 底部显示可见范围，例如 `5-12/27`。
- 窄终端优先保留完整命令；空间不足时截断简介，不允许超过终端宽度。
- resize 后使用当前宽度重新计算命令列、简介列和选中窗口。
- `NO_COLOR` 下仍通过 ASCII `>` 标记选中项；彩色终端同时使用反显。
- 非 TTY、`exec` 和 JSONL 模式不显示提示框。

## 4. 实现边界

命令、别名、简介、子命令和动态值来源统一定义在 `CommandRegistry`。提示框不解析或执行
命令，只负责展示和补齐；最终输入仍经过原有命令解析、workflow revision 和 VM 安全边界。
本功能不修改 Sentaurus-agent 后端协议，也不增加任意 slash command 透传。

## 5. 验收范围

自动化测试覆盖：

- 一级命令实时过滤及一行简介；
- goal、plan、model 多级候选；
- session、模型、plan step 动态候选；
- Up/Down 循环选择和提示框关闭后的历史浏览；
- Tab 连续补齐、Esc 关闭及 Tab 重新打开；
- 20 列窄终端、长简介截断、候选窗口和宽度约束；
- 模拟 TTY 下的实际 keypress 路由与提交结果。

交付验收结果：

| 检查项 | 结果 |
| --- | --- |
| `npm run check` | 通过：类型检查、40 项测试和构建全部成功 |
| `npm pack --dry-run` | 通过：0.6.0 包含 119 个文件，未在工作区生成 tarball |
| `npm audit --omit=dev` | 通过：0 个已知漏洞 |
| 构建后 `--version` / `--help` / `features --json` | 通过：版本、使用说明和 `slash_command_palette` 功能标记一致 |

完整命令说明见 [CLI 指令功能参考](cli-command-reference.zh-CN.md)。
