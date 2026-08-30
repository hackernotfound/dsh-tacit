<h1 align="center">Tacit</h1>

<p align="center"><b>学习你在提示词里没说出口的东西——并替你告诉智能体。</b><br>
一个 <a href="https://www.npmjs.com/package/@deepseek-ai/dsh">DeepSeek Harness</a> 插件。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-tacit"><img alt="npm" src="https://img.shields.io/npm/v/dsh-tacit"></a>
  <a href="https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml"><img alt="test" src="https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml/badge.svg"></a>
  <a href="https://github.com/hackernotfound/dsh-tacit/blob/main/LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="https://github.com/hackernotfound/dsh-tacit/blob/main/README.md">English</a>
</p>

> 本文由英文版翻译而来，尚未经过母语者校对；以 [README.md](https://github.com/hackernotfound/dsh-tacit/blob/main/README.md) 为准，欢迎提交修正。

你照常写提示词。Tacit 在后台观察每一轮*实际*的走向——重试、工具报错，尤其是
智能体做错之后你发的那条消息——把你的习惯变成几条指令，让智能体在每个新对话里
自动遵守。无需点击，每次学习 $0.001–0.003。

```
你:     "把登录页做好一点"
智能体: …走偏…
你:     "不对，我是说 apps/web 下的 Next.js 应用"

Tacit:  学到 → "用户常常不说明是哪个应用——先查 apps/web。"
        注入之后每个对话的系统提示。
        你再也不用重复说了。
```

## 安装——30 秒

```bash
npx @deepseek-ai/dsh plugin --profile web add dsh-tacit
```

用 `npx @deepseek-ai/dsh web` 启动（或重启），然后刷新页面。可选的快速起步：**设置 → Tacit → *从我最近 20 轮中学习***
（约 $0.02–0.05，一次性）。

需要 DeepSeek Harness `>= 0.1.1-rc.1`、Node `>= 22`，以及已在 harness 里配置好的
DeepSeek API Key（Tacit 从不读取它）。

## 你会得到什么

| | 是什么 | 费用 |
| --- | --- | --- |
| **零点击学习** | 不顺的轮次和你自己的纠正会在后台被分析，并带上上一轮作为上下文；自动分析每天有上限（默认 30 次） | 每次 $0.001–0.003 |
| **指令要靠表现留下** | 学到的指令作为一小段系统提示注入，你可以查看、编辑、开关或删除；新指令先是*候选*，如果你的不顺轮次比例变差就会退役 | 免费 |
| **✨ 改进** | 输入框里的按钮，用 Tacit 学到的东西重写当前草稿，带前后对比预览和 👍/👎 | 每次点击 $0.001–0.002 |
| **测量而非猜测** | 设置页显示你的真实趋势：不顺轮次比例和每轮 token 数，最早 20 轮 vs 最近 20 轮——以及 Tacit 自己的花费：每次调用都被计量并按目录价定价，显示在设置页里 | 免费 |

## 它是怎么工作的

1. Tacit 为每一轮保留一份很小的有界摘要：提示词、跑了哪些工具、哪里出错、怎么结束。
2. 当一轮结束得不顺、或你的下一条消息像是纠正，就用一次很小的 `deepseek-v4-flash`
   调用分析那条提示词，记下缺了什么。
3. 每隔几次分析，再用一次调用把发现蒸馏成 1–4 条一句话的指令。每条新指令试用 10 轮。
4. 指令成为每个新对话系统提示里约 300 token 的一段——原文在设置里可见；离开本机的
   只有你各轮的裁剪摘要。

完整流程（含每个数字和一张图，英文）：
[How it works](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/how-it-works.md)。

## 隐私与成本，一段话

Tacit 从不接触你的 API Key（所有调用都经过 harness 自己的模型服务），只通过你会话
自己的 provider 路由调用白名单里的官方模型，报告和指令都存放在
`~/.dsh/storages/tacit/`，拒绝对自身路由的跨站请求，除了自己的报告和过期的用量记录
之外从不删除任何东西。美元数字是按公开价格的估算；`dsh-cost-meter` 这样的成本插件会显示真实花费。
完整的数据流与成本表、以及坦白的限制清单（英文）：
[Privacy, cost & limitations](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/privacy-and-cost.md)。

## 文档（除标注外均为英文）

| | |
| --- | --- |
| [快速开始](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/getting-started.zh.md)（[English](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/getting-started.md)） | 安装、确认已启用、快速起步、界面各处在哪、排障 |
| [How it works](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/how-it-works.md) | 逐步流程，带图和术语表 |
| [Privacy, cost & limitations](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/privacy-and-cost.md) | 什么留在本地、什么会发出去、每次调用的花费、目前做不到的事 |
| [Configuration](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/configuration.md) | 所有设置项、默认值和取值范围 |
| [Architecture](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/architecture.md) | 面向贡献者：模块、钩子、路由、存储 |
| [贡献指南](https://github.com/hackernotfound/dsh-tacit/blob/main/docs/CONTRIBUTING.zh.md)（[English](https://github.com/hackernotfound/dsh-tacit/blob/main/CONTRIBUTING.md)） | fork → 分支 → PR 的流程、测试、基本规则；欢迎提 issue 和 PR |
| [Changelog](https://github.com/hackernotfound/dsh-tacit/blob/main/CHANGELOG.md) | 各版本的变更 |

MIT © hackernotfound
