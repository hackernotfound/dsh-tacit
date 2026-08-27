<h1 align="center">Tacit</h1>

<p align="center"><b>学习你在提示词里没说出口的东西——并替你告诉智能体。</b><br>
一个 <a href="https://www.npmjs.com/package/@deepseek-ai/dsh">DeepSeek Harness</a> 插件。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-tacit"><img alt="npm" src="https://img.shields.io/npm/v/dsh-tacit"></a>
  <a href="https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml"><img alt="test" src="https://github.com/hackernotfound/dsh-tacit/actions/workflows/test.yml/badge.svg"></a>
  <a href="../LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="../README.md">English</a>
</p>

> 本文由英文版翻译而来，尚未经过母语者校对；以 [README.md](../README.md) 为准，欢迎提交修正。

你照常写提示词。Tacit 在后台观察每一轮*实际*的走向——重试、工具报错，尤其是
智能体做错之后你发的那条消息——把你的习惯变成几条指令，让智能体在每个新会话里
自动遵守。无需点击，每次学习约 $0.001。

```
你:     "把登录页做好一点"
智能体: …走偏…
你:     "不对，我是说 apps/web 下的 Next.js 应用"

Tacit:  学到 → "用户常常不说明是哪个应用——先查 apps/web。"
        注入之后每个会话的系统提示。
        你再也不用重复说了。
```

## 安装——30 秒

```bash
dsh plugin --profile web add dsh-tacit
```

重启 `dsh web`，刷新页面。可选的快速起步：**设置 → Tacit → *从我最近 20 轮中学习***
（约 $0.02，一次性）。

需要 DeepSeek Harness `>= 0.1.1-rc.1`、Node `>= 22`，以及已在 harness 里配置好的
DeepSeek API Key（Tacit 从不读取它）。

## 你会得到什么

- **零点击学习**——不顺的轮次和你自己的纠正会在后台被分析，并带上上一轮作为上下文。
  每天有上限（默认 30 次）。*每次分析约 $0.001*
- **指令要靠表现留下**——学到的指令作为一小段系统提示注入，你可以查看、编辑、开关或
  删除。新指令先是*候选*，如果你的不顺轮次比例变差就会自动退役。*免费*
- **✨ 改进**——输入框里的按钮，用 Tacit 学到的东西重写当前草稿，带前后对比预览和
  👍/👎。*每次点击约 $0.001*
- **测量而非猜测**——设置页显示你的真实趋势：不顺轮次比例和每轮 token 数，最早 20 轮
  vs 最近 20 轮。*免费*

## 它是怎么工作的

1. 对会话事件做纯折叠，得到每一轮的有界摘要。
2. 当一轮结束得不顺、或你的下一条消息像是纠正，就用一次很小的 `deepseek-v4-flash`
   调用（低推理强度，结构化输出）分析那条提示词。
3. 每隔几次分析，再用一次调用把发现蒸馏成 2–4 条指令。
4. 指令被渲染成系统提示里 ≤300 token 的一段——原文在设置里可见，除此之外你的提示词
   不会离开本机。

## 隐私与成本，一段话

Tacit 从不接触你的 API Key（所有调用都经过 harness 自己的模型服务），只调用白名单里的
官方模型，报告和指令都存放在 `~/.dsh/storages/tacit/`，拒绝对自身路由的跨站请求，
除了自己的报告之外从不删除任何东西。美元数字是按公开价格的估算；`dsh-cost-meter`
这样的成本插件会显示真实花费。完整细节（包括坦白的限制清单，英文）：
[docs/privacy-and-cost.md](privacy-and-cost.md)。

## 更多

[配置](configuration.md) ·
[隐私、成本与限制](privacy-and-cost.md) ·
[架构](architecture.md) ·
[参与贡献](../CONTRIBUTING.md) ·
[更新日志](../CHANGELOG.md)（均为英文）

MIT © hackernotfound
