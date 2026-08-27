# Tacit — DeepSeek Harness 插件

[![test](https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml/badge.svg)](https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/dsh-tacit)](https://www.npmjs.com/package/dsh-tacit)
[English](README.md)

> 本文由英文版翻译而来，尚未经过母语者校对；以 [README.md](README.md) 为准，欢迎提交修正。

**Tacit 学习你在提示词里没说出口的东西，并替你补给智能体。**

你照常写提示词。Tacit 在后台观察每一轮的走向——重试、工具报错、上下文压缩，
尤其是*智能体做错之后你发的下一条消息*——从中学习你的习惯，并把它们变成一小组
**智能体在每个新会话里替你遵守的指令**。无需点击；每次学习约 $0.001（估算，见「成本」）。

```
你: "把登录页做好一点"
     ↓ （智能体走偏，你说"不对，我是说 apps/web 下的 Next.js 应用"）
Tacit 学到: "用户常常不说明是哪个应用/目录——先查 apps/web。"
     ↓ 之后每个会话的系统提示都带上这条指令
智能体: 先查 apps/web。你再也不用重复说了。
```

## 它做什么

| 层 | 发生什么 | 成本 |
| --- | --- | --- |
| **零点击学习**（默认开） | 当一轮结束得*不顺*（重试 / 工具报错 / 压缩 / 被拒 / ≥15 步），或你的下一条消息像是在纠正（"不对，我是说…"、"你为什么…"），Tacit 自动分析那条提示词，并把你的纠正作为证据。每天有上限（默认 30 次）。 | 每次分析约 $0.001（`deepseek-v4-flash`，低推理强度，结构化输出） |
| **环境引导**（默认开） | 每隔几次分析，一次很小的调用把学到的东西蒸馏成 2–4 条**给智能体的指令**，作为 ≤300 token 的段落注入每个*新*会话的系统提示。你可以在 设置 → Tacit 看到原文，关闭、删除任意一条，或自己添加。 | 约等于免费（缓存输入） |
| **✨ 改进**（默认开） | 输入框里的按钮，按需用学到的模式、风格规则和你最近的 👎 原因重写当前草稿。前后对比预览，*应用* / *取消*，然后 👍/👎（👎 会要一句原因；三条原因蒸馏成风格规则）。 | 每次点击约 $0.001 |
| **发送前补充**（默认关，需手动开启） | 每轮第一步之前，一次小调用在你**原封不动的消息之后**追加一条插件消息（"来自 Tacit 的上下文：用户大概率是指…；先查…"）。从不改写你的话；补充内容在 Tacit 标签里可见。 | 每次发送约 $0.001 |
| **测量而非猜测** | 设置页显示来自你自己会话的真实趋势：不顺轮次比例和每轮 token 数，最早 20 轮 vs 最近 20 轮。 | 免费 |
| **指令要靠表现留下** | 新蒸馏出的指令先是*候选*：在接下来 10 轮结束期间（跨所有会话）注入，然后转正——或者当这些轮次的不顺比例比基线高出 15 个百分点以上时**自动退役**。退役的指令仍在设置里可见（附原因），可手动重新启用。 | 免费 |
| **引导** | *从我最近 20 轮中学习*（Tacit 标签 = 本会话，设置 = 所有会话）立即分析最近的轮次并蒸馏指令——新安装的快速起步（分析逐条串行执行，需要几分钟）。纯"继续"类消息（"继续"、"好的"）和已分析过的轮次会被跳过。**不受每日上限约束。** | 一次性约 $0.02 |

## 环境要求

- DeepSeek Harness `>= 0.1.1-rc.1`（`npx @deepseek-ai/dsh web`），Node `>= 22`
- 在 harness 里配置好 DeepSeek API Key（设置 → 模型）——Tacit 从不读取它，只调用 harness 自己的模型服务

## 安装

```bash
dsh plugin --profile web add dsh-tacit
# 重启 `dsh web`，然后刷新页面
```

从代码检出安装（开发用）：`dsh plugin --profile web add /abs/path/to/dsh-tacit`。
`dsh plugin add` 会在 profile 目录里转发给 pnpm，并同步 `dsh.profile.bundles`。
从 `dsh-prompt-coach` 迁移：移除旧条目、添加本插件——旧的 `~/.dsh/storages/prompt-coach`
目录会被自动接管。

## 界面在哪里

- **Tacit 标签**：在对话视图（聊天 / 轨迹 / 上下文旁边）。每一轮的摘要、每份报告上的
  *自动* / *纠正* / *手动* 标记、发送前 Tacit 补充的上下文（需开启），以及手动
  *分析* 按钮 / 批量勾选。
- **设置 → Tacit**：已学习数量、自动学习状态（今日用量 vs 上限）、测量趋势、
  **智能体被告知的关于你的信息**（切换 / 删除 / 添加指令，注入原文）、风格规则、
  跨会话的已分析提示词列表，以及每一层的开关。
- **输入框**：✨ 改进按钮；应用重写后出现 👍/👎 条。

## 配置

在界面里改的设置保存在 `~/.dsh/storages/tacit/`。默认值也可以在 profile 的用户
patch 层（`~/.dsh/profiles/web/cordis.patch.yml`）里设置：

```yaml
- id: tacit
  config:
    model: deepseek-v4-pro
    autoDailyBudget: 50
    enrichPrompts: true
```

全部键（括号内为默认值）：`model: deepseek-v4-flash`（允许 `deepseek-v4-flash` /
`deepseek-v4-pro`）、`autoAnalyze: true`、`autoDailyBudget: 30`、`autoMinSteps: 15`、
`steerAgent: true`、`directiveEvery: 3`、`directiveTrialTurns: 10`、`directiveWorseBy: 0.15`、
`enrichPrompts: false`、`liveSuggestions: true`（✨ 按钮）、`maxKeptTurns: 60`、
`maxPromptChars: 4000`、`maxToolCallChars: 500`、`maxAssistantChars: 4000`、
`maxToolCallsPerTurn: 50`、`maxPatterns: 12`。
`learningThreshold` 为兼容保留但被忽略（已无门槛），可安全地从 `config.patch.json`
删除。引导的轮数（20）是 API 参数（`limit`，1–50），不是设置项。

## 安全与隐私

- **从不读取或存储 API Key**——所有模型调用都经过 harness 自己的 LLM 服务
  （`ctx.llm.stream`），使用你在 设置 → 模型 里配置的 Key。
- **没有自定义端点**——模型在官方 provider 上白名单化（跟随会话自己的 provider，
  回退到 `deepseek-official`）。
- **有界的本地数据**——只有裁剪后的轮次摘要离开本机；报告、画像和指令都留在
  `~/.dsh/storages/tacit/`。
- **带上下文的分析**——每次分析都能看到上一轮；纯"继续"会结合上下文判断，
  沉重但成功的工作从不归咎于提示词，会让智能体*反过来问你*的指令会被丢弃。
- **可见的引导**——注入的系统提示段落原文在设置里可见，也可整体关闭（`steerAgent`）。
  该段落按会话冻结，以保持模型前缀缓存有效。
- **仅限同源**——harness 的 web 服务器没有来源策略，所以 Tacit 的路由自己拒绝跨站请求
  （fetch-metadata、`Origin` 和 content-type 检查）：你碰巧访问的网页无法通过 `127.0.0.1`
  植入指令或花掉你的预算。
- **只追加的发送前补充**——需手动开启，从不改写你的消息：追加一条单独的、来源标记为
  插件的消息，且有记录、可见。
- **成本护栏**——自动调用有每日上限（`autoDailyBudget`）；每次调用都用低推理强度、
  工具 schema 结构化输出（不会对散文做修复循环），并归属到会话，方便成本插件统计。
  引导是唯一有意的例外：一次点击最多运行 20 次不受上限约束的分析。
- **从不删除已有文件**——唯一的删除操作是设置里的*清除所有分析报告*，只移除插件自己的
  `reports/<session>/<turn>.json` 文件。

## 成本

上面的美元数字是按 DeepSeek 公开价格对 `deepseek-v4-flash` 在 Tacit 使用的 token 预算
（每次分析 ≤ 3000 输出 token、每次蒸馏 ≤ 1000、低推理强度）做的**估算**。Tacit 自己不记账；
每次调用都带会话 id，所以像 [`dsh-cost-meter`](https://www.npmjs.com/package/dsh-cost-meter)
这样的成本插件会在会话旁边显示真实花费。

## 已知限制

坦白列表——这些是 v0.2 的既定行为，不是隐藏的坑：

- **引导段落按会话冻结。** 会话第一次组装系统提示时就固定了原文（为了模型前缀缓存）。
  所以退役判定*以及*你在 设置 → Tacit 里的切换、编辑、添加，都只对**新会话**生效；
  正在进行的会话保持开始时的版本。
- **试用是全局计数，不是按指令计数。** 每个候选看到的是同一组已结束 / 不顺轮次数，
  所以一起蒸馏出的候选会得到相同的判定。这是趋势检查，不是每条指令的 A/B 测试。
- **"不顺"有两种略微不同的含义。** 自动分析把 ≥ `autoMinSteps` 步的轮次也算不顺；
  趋势条和试用判定只算重试、工具报错、压缩、被拒和取消（又长又成功的工作从不算在
  指令头上）。
- **引导串行执行**且不受每日上限约束（见「成本护栏」）。
- 指令是全局的，不按工作区区分；从*好的*提示词学习和每周摘要尚未实现。

## 架构

| 部分 | 机制 |
| --- | --- |
| 轨迹读取 | `ctx.sessionProjections` 单元 `tacitTimeline`（对会话事件的纯折叠，防 fork 种子，有界保留）；浏览器通过 `useProjection` 读取 |
| 零点击触发 | `sessionProjections.onChanged`（不轮询）：不顺轮次和纠正的启发式是普通代码；只有分析本身是模型调用 |
| 引导 | `ctx.systemPrompt.section({ name: 'tacit:steering', order: 60 })`，文本按会话冻结 |
| 发送前补充 | `agent/pre-step` 瀑布监听器，只追加，`enrichPrompts` 关闭时不做任何事 |
| 模型调用 | `ctx.llm.stream`，`reasoningEffort: 'low'`，用工具 schema 做结构化输出 |
| 浏览器 ↔ 宿主 | harness web 服务器上的 `/api/tacit/*` JSON 路由 |
| UI | `conversation.view` 标签、`conversation.input.left` 按钮、`conversation.input.overlay` 预览、`conversation.composer.dock` 反馈条、`settings.section` 页面——通过 `window.__ModuleLoader__` 的原生 `React.createElement` |
| 存储 | `~/.dsh/storages/tacit/`——`config.patch.json`、`profile.json`、`auto.json`、`reports/<sessionId>/<turn>.json`，原子写入 |

## 开发

```bash
pnpm install   # zod、dsh-home-paths、dsh-llm（+ react/react-dom 用于 SSR 客户端测试）
pnpm test      # node --test：fold、calls、analysis、trust、schema、store、宿主集成（stub 的 harness）、客户端 SSR
pnpm smoke     # 对运行中的 dsh web 做端到端冒烟（真实模型调用，约 $0.005）；TACIT_BASE 可改地址
```

欢迎贡献——见 [CONTRIBUTING.md](CONTRIBUTING.md)：检出 / 链接流程、重启 vs 刷新规则，
以及基本规则（行为改动要有测试、zh/en 字典保持同步、不处理 Key）。

## 许可证

MIT
