# 参与 Tacit 开发

> 本文由英文版翻译而来，尚未经过母语者校对；以 [CONTRIBUTING.md](../CONTRIBUTING.md) 为准，欢迎提交修正。

感谢你的关注。Tacit 是一个小巧、免构建的
[DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（`dsh`）插件：
纯 ES 模块，没有打包器，没有 TypeScript 编译步骤。参与开发不需要推送权限、
签名密钥或 API Key——整套测试都跑在一个桩（stub）harness 上。

## 前置条件

- Node ≥ 22 和 pnpm 11.23.0（`corepack enable` 会遵循 `packageManager` 里钉住的版本）
- 一个 GitHub 账号（用来 fork 和提交 pull request）
- 一个能用的 `dsh`（`npx @deepseek-ai/dsh web`），并在「设置 → 模型」里配置好
  DeepSeek API Key——只有在想实际体验你的改动或跑 smoke 测试时才需要，单元测试不需要

## 找点事做

- [`good first issue`](https://github.com/hackernotfound/dsh-tacit/labels/good%20first%20issue)
  ——小而明确，带验收标准和代码位置。
- [`help wanted`](https://github.com/hackernotfound/dsh-tacit/labels/help%20wanted)
  ——更大的任务，设计尚未定案；先在 issue 里留言，维护者会和你一起讨论方案。
- 其他你注意到的问题：提一个
  [issue](https://github.com/hackernotfound/dsh-tacit/issues/new/choose)，或在
  [Discussions](https://github.com/hackernotfound/dsh-tacit/discussions) 里问。

如果一个任务需要你花超过一小时，开始前请在 issue 下留言，避免重复劳动。
代码在哪里见 [docs/architecture.md](architecture.md)（英文）。

## Fork、克隆、链接

```bash
gh repo fork hackernotfound/dsh-tacit --clone      # 或在 github.com 上 fork 后 git clone 你的 fork
cd dsh-tacit
git remote add upstream https://github.com/hackernotfound/dsh-tacit   # 如果 gh 已经加过就跳过
pnpm install
npx @deepseek-ai/dsh plugin --profile web add "$PWD"   # 把这个目录链接进 ~/.dsh/profiles/web
```

然后启动（或重启）`npx @deepseek-ai/dsh web`，刷新 harness 页面。

**重启 vs 刷新：** `lib/` 下的代码运行在宿主进程里——改了之后要重启
`npx @deepseek-ai/dsh web`。浏览器端的源码在 `client/src/`（每个部分一个文件，
没有 import——harness 每个插件只加载一个普通 script），用 `pnpm build:client`
重新生成 `client/client.js`，然后刷新页面即可。不要手改 `client/client.js`——
`pnpm check:client`（CI 也会跑）会拒绝与源码不一致的产物。
只有 `package.json` 的依赖变化时才需要重新安装。

## 测试

```bash
pnpm test                 # node --test：fold、calls、analysis、trust、schema、store、宿主集成、客户端 SSR
pnpm build:client         # 从 client/src/ 重新生成 client/client.js
pnpm check:client         # 提交的 client/client.js 与 client/src/ 一致
pnpm check:docs           # 本地 Markdown 链接和锚点
pnpm check:package        # npm 包内容和英文根 README
pnpm check                # 以上四项全部
pnpm smoke                # 对运行中的 dsh web 做 HTTP 端到端测试（不调用模型，免费）
TACIT_SMOKE_SESSION=<id> pnpm smoke           # 额外测试 ✨ 改进：一次真实模型调用，约 $0.001
TACIT_BASE=http://127.0.0.1:4000 pnpm smoke   # 如果你的 dsh web 不在 :3080
pnpm rehearse             # 在一次性 DSH_HOME 里跑真实 headless 回合：端到端验证零点击闭环
                          # 需要在 harness 里配好 DeepSeek API key；每次 Tacit 调用约 $0.001，另加 agent 自身的回合开销
pnpm check:ci-logs        # 扫描本仓库最近的 GitHub Actions 日志，查凭证、个人路径和邮箱地址；需要 gh 已登录
```

CI 会在每次 push 和 PR 上用 Node 22 和 24 跑 `pnpm test`，外加文档和包检查。
请保持 CI 绿色。

## 提交 pull request

```bash
git fetch upstream
git switch -c fix/short-description upstream/main   # feat/、fix/、docs/、chore/、refactor/
# … 做你的修改 …
pnpm check
git commit -am "fix: short description"
git push -u origin fix/short-description
gh pr create        # 或在 github.com 上从你的 fork 发起 PR
```

- 一个 PR 只做一件事。一个修复和一个无关的重构是两个 PR。
- PR 模板会问几个要点：改了什么、为什么，`pnpm check` 是否通过，行为变化是否有测试，
  `zh`/`en` 是否同步，以及值得发布的改动是否在 `CHANGELOG.md` 的 `## Unreleased` 下加了一行。
- 你**不需要**签名提交，也不需要整理历史；维护者合并时会 squash 或 rebase。
- 通常几天内会有 review。请求修改针对的是 diff，从来不是针对你。

## 基本规则

- **行为要有测试。** 任何改变 Tacit 学什么、注入什么、花什么钱的改动，都需要在 `test/`
  里有测试。集成测试把整个 harness 打了桩（`test/integration.test.mjs`），不需要 Key。
- **`zh` 和 `en` 字典保持同步。** 两者都在 `client/client.js` 里，键集合不一致时会有测试失败。
  如果你只会其中一种语言，尽力翻译另一种并在 PR 里说明——欢迎母语者来校对。
- **绝不添加让 Tacit 读取 API Key 或调用自定义端点的途径。** 所有模型调用都经过
  `ctx.llm.stream`；模型在 `lib/schema.js` 里有白名单。
- **成本是功能的一部分。** 每次调用必须使用 `reasoningEffort: 'low'` 并带 tool schema，
  且传入 `sessionId` 以便成本插件归因，并用 `metered()` 包裹调用，使其计入用量台账；
  新的*自动*调用应当有上限（见 `autoDailyBudget`）。任何新调用都要加进
  [docs/privacy-and-cost.md](privacy-and-cost.md#cost) 的成本表。
- **不删用户数据。** 只有两条删除路径，且都只限于 Tacit 自己的文件：分析报告
  （`reports/<session>/<turn>.json`），通过设置里的「清除所有分析报告」；以及
  超过 `costHistoryDays` 的用量日文件（`usage/<YYYY-MM-DD>.json`），或通过
  `clearUsage()` 一次性清空全部。磁盘上其他任何东西都不会被触碰，两个目录本身
  也从不会被删除。

## 代码在哪里

行为说明：[docs/how-it-works.md](how-it-works.md)。代码地图、钩子、路由和存储：
[docs/architecture.md](architecture.md)。简版：`lib/fold.js` 把会话事件折叠成每轮摘要，
`lib/analyze.js` 放提示词、启发式规则和模型调用，`lib/service.js` 是宿主服务
（自动触发、试用、快速起步、steering），`lib/routes.js` 是 JSON API，
`client/src/*.js` 是全部 UI（i18n、API 客户端、store、组件、面板、CSS、插件主体——
拼接成发布的 `client/client.js`）。

## 报告 bug

使用 [bug 报告表单](https://github.com/hackernotfound/dsh-tacit/issues/new/choose)。
它会要 dsh 版本（`npx @deepseek-ai/dsh --version`）、你输入了什么、Tacit 标签页或控制台
显示了什么，以及——如果和某条指令有关——设置 → Tacit 里的指令原文。粘贴提示词前请
去掉任何隐私内容。疑似安全漏洞请走 [SECURITY.md](../SECURITY.md)，不要开公开 issue。

## 发布策略（仅维护者）

贡献者不需要执行这里的任何操作；写在这里只是为了让版本号可预期。不是每个合并的改动
都需要发 npm：

- **patch** 版本：修复、运行时依赖或配置变化、打包进 npm 的宿主/客户端改动、
  以及必须出现在 npmjs.com 上的根 `README.md` 更新。
- Tacit 在 1.0 之前，新功能和破坏性变更用 **minor** 版本。
- 仅限 GitHub 的 `docs/` 改动、测试、CI、贡献者文件、安全文件或仓库设置不发版。

值得发布的说明写在 `CHANGELOG.md` 的 `## Unreleased` 下。发版时把该节改成带日期的版本节，
然后运行 `npm version patch` 或 `npm version minor`，用 `git push --follow-tags` 推送
提交和标签。推送 `v*` 标签后会自动发布到 npm，通过 OIDC trusted publishing 带 provenance，
不需要 npm token。绝不移动已有的发布标签；发布后的修正用新的 patch 版本。
