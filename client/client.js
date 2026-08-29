// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — Client half (installed package bundle entry, zero-build).
 *
 * Registered through window.__ModuleLoader__ like every web client bundle;
 * `react` and the UI primitives resolve from the browser module table via the
 * injected require. Everything else is inlined plain JavaScript.
 *
 * UI surface:
 *  - a "Tacit" tab in the conversation view ring (`conversation.view`
 *    slot, beside Chat/Trajectory) listing every turn's digest with an
 *    Analyze button and the analysis report;
 *  - a small ✨ Improve button in the composer tool row
 *    (`conversation.input.left`) while it is enabled in Settings;
 *  - a before/after preview popup in `conversation.input.overlay` whose
 *    Apply action replaces the composer draft via `inputActions.setDraft`.
 *
 * Data plane: the host half pushes the trajectory digest through the
 * harness's session-projection pipeline (`tacitTimeline`, read with the
 * standard `useProjection` prop) and serves the model calls over the
 * plugin's own /api/tacit/* JSON routes on the harness web server.
 * No custom server, no bundled zod, no secrets on this side.
 */

// Non-browser imports are a no-op (the harness loads this bundle in the
// browser only; the guard also keeps Node-based tests of this file safe).
if (typeof window === 'undefined' || window.__ModuleLoader__ === undefined || typeof window.__ModuleLoader__.load !== 'function') {
  // eslint-disable-next-line no-void
  void 0
} else window.__ModuleLoader__.load({
  id: 'dsh-tacit',
  factory: (require) => {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const MarkdownText = primitives !== undefined && primitives.MarkdownText !== undefined
      ? primitives.MarkdownText
      : null
    const h = React.createElement
    const { useState, useEffect } = React

    const NS = 'dsh-tacit'

    // ── i18n ────────────────────────────────────────────────────────────────

    const DICT_ZH = {
      tab: 'Tacit',
      'status.learned': '已从 {count} 个提示词中学习',
      'status.autoOn': '自动学习已开启 · 今日 {today}/{budget}',
      'status.autoOff': '自动学习已关闭 — 仅在你点击「分析」时学习。',
      'status.autoHint': '混乱的轮次（重试、工具错误、压缩）以及你纠正智能体的下一条消息会被自动分析，无需点击。',
      'status.trendMessy': '混乱轮次：{a} → {b}',
      'status.trendTokens': '每轮 tokens：{a} → {b}',
      'status.trendHint': '（最早 {n} 轮 vs 最近 {n} 轮，真实数据）',
      'turn.enrichment': '发送前补充的上下文',
      'trigger.auto': '自动',
      'trigger.correction': '纠正',
      'trigger.manual': '手动',
      'trigger.bootstrap': '引导',
      'bootstrap.btn': '从我最近 20 轮中学习',
      'bootstrap.running': '学习中… {done}/{total}',
      'bootstrap.hint': '约 $0.02–0.05，一次性。已顺利完成的提示词会被跳过。',
      'steer.enrich': '发送前补充学到的上下文（实验性，每次发送一次小调用）',
      'steer.title': '智能体被告知的关于你的信息',
      'steer.desc': '这些指令会注入每个新会话的系统提示词，让智能体替你补上你通常没说的内容。',
      'steer.toggle': '将学到的指令注入系统提示词',
      'steer.empty': '还没有指令——分析几个提示词后会自动提炼，或在下方添加你自己的。',
      'steer.add': '添加你自己的指令',
      'steer.addPlaceholder': '例如：「你觉得呢」只是要意见，不要动手实现。',
      'steer.remove': '删除',
      'steer.preview': '实际注入的文本',
      'steer.distilled': '自动提炼',
      'steer.trial': '试用 {n}/{total}',
      'steer.active': '已生效',
      'steer.retired': '已淘汰 · {reason}',
      'steer.user': '你添加的',
      'settings.auto': '自动分析混乱轮次',
      'settings.budget': '每日自动分析上限',
      settings: '设置',
      'settings.title': 'Tacit 设置',
      'settings.sectionLabel': 'Tacit',
      'panel.title': 'Tacit',
      'panel.coached': '已分析的提示词',
      'panel.coachedEmpty': '还没有分析过的提示词——在对话的「Tacit」标签里勾选提示词并点击「分析所选」。',
      'panel.hint': '挑选提示词：打开任意对话，点击「Tacit」标签。',
      'settings.model': '分析模型',
      'settings.live': '启用输入框改进按钮',
      'settings.apply': '应用',
      'settings.clear': '清除所有会话的分析报告',
      'settings.cleared': '已清除 {n} 份报告',
      'settings.close': '收起',
      empty: '发送消息后，每一轮对话的轨迹摘要会出现在这里——勾选你想分析的提示词，然后点击「分析所选」。',
      'coach.selected': '分析所选（{n}）',
      'coach.select': '选择提示词…',
      'coach.selectDone': '完成选择',
      'manual.hint': '觉得某个提示词写得不好，但那一轮却顺利完成了？可以手动分析——一次小调用。',
      'turn.interrupted': '已中断',
      'turn.report': '报告',
      'coach.batchRunning': '正在分析…',
      'turn.select': '选择此提示词以分析',
      'turn.tools': '{n} 个工具调用',
      'turn.steps': '{n} 步',
      'turn.tokens': '≈{n} tokens',
      'turn.retries': '重试 {n}',
      'turn.expand': '展开',
      'turn.collapse': '收起',
      'turn.analyze': '分析',
      'turn.analyzing': '分析中…',
      'turn.reanalyze': '重新分析',
      'turn.running': '进行中',
      'report.problems': '发现的问题',
      'report.improved': '改进后的提示词',
      'report.explanation': '说明',
      'report.copy': '复制',
      'report.copied': '已复制',
      'report.emptyImproved': '(模型未给出改写版本)',
      'sev.high': '高',
      'sev.medium': '中',
      'sev.low': '低',
      'sev.info': '提示',
      'improve.btn': '改进提示词',
      'preview.title': '改进预览',
      'preview.original': '原文',
      'preview.improved': '改进后',
      'preview.rationale': '改动说明',
      'preview.pending': '正在分析草稿…',
      'preview.apply': '应用改进',
      'preview.cancel': '取消',
      'feedback.title': '这次改进有帮助吗？',
      'feedback.up': '有帮助',
      'feedback.down': '没有帮助',
      'feedback.reasonPlaceholder': '一句话说明哪里不好…',
      'feedback.send': '发送反馈',
      'feedback.noted': '已记录，谢谢！',
      'panel.styleRules': '已学习的风格规则',
      'panel.styleRulesEmpty': '还没有学习到风格规则——应用改进后给出 👎 反馈（附一句话原因），累计 3 次即可提炼出规则。',
      'err.bad-request': '请求无效。',
      'err.bad-json': '请求体无效。',
      'err.no-session': '当前会话不可用（可能尚未在本进程恢复）。',
      'err.not-retained': '该轮次已超出保留窗口，无法分析。',
      'err.busy': '该轮次的分析已在运行中。',
      'err.no-llm': '无法访问模型服务。',
      'err.no-api-key': 'DeepSeek API Key 缺失或无效（请在 设置 → 模型 中配置）。',
      'err.rate-limited': '请求被限流，请稍后重试。',
      'err.timeout': '模型调用超时，请重试。',
      'err.empty-response': '模型没有返回内容，请重试。',
      'err.call-failed': '模型调用失败：{detail}',
      'err.network': '无法连接 Tacit 服务。',
      'err.internal': '内部错误：{detail}',
      'err.continuation': '这是一条纯粹的「继续」类消息（没有可分析的意图）——请分析它之前的那一轮。',
    }

    const DICT_EN = {
      tab: 'Tacit',
      'status.learned': 'Learned from {count} prompt(s)',
      'status.autoOn': 'Auto-learning on · {today}/{budget} today',
      'status.autoOff': 'Auto-learning off — Tacit only learns when you click Analyze.',
      'status.autoHint': 'Messy turns (retries, tool errors, compactions) and turns you correct in your next message are analyzed automatically — no clicks.',
      'status.trendMessy': 'Messy turns: {a} → {b}',
      'status.trendTokens': 'Tokens/turn: {a} → {b}',
      'status.trendHint': '(first {n} turns vs. latest {n}, measured)',
      'turn.enrichment': 'Context added before the send',
      'trigger.auto': 'auto',
      'trigger.correction': 'correction',
      'trigger.manual': 'manual',
      'trigger.bootstrap': 'bootstrap',
      'bootstrap.btn': 'Learn from my last 20 turns',
      'bootstrap.running': 'Learning… {done}/{total}',
      'bootstrap.hint': '≈ $0.02–0.05, one time. Skips prompts that already went fine on their own.',
      'steer.enrich': 'Add learned context before each send (experimental — one small call per send)',
      'steer.title': 'What the agent is told about you',
      'steer.desc': 'These directives ride every new session\'s system prompt so the agent fills in what you usually leave unsaid.',
      'steer.toggle': 'Inject learned directives into the system prompt',
      'steer.empty': 'No directives yet — they are distilled automatically after a few analyses, or add your own below.',
      'steer.add': 'Add your own directive',
      'steer.addPlaceholder': 'e.g. "What do you think" means opinion only — do not build anything.',
      'steer.remove': 'Remove',
      'steer.preview': 'Exact text injected',
      'steer.distilled': 'distilled',
      'steer.trial': 'trial {n}/{total}',
      'steer.active': 'active',
      'steer.retired': 'retired · {reason}',
      'steer.user': 'yours',
      'settings.auto': 'Auto-analyze messy turns',
      'settings.budget': 'Daily cap on automatic analyses',
      settings: 'Settings',
      'settings.title': 'Tacit settings',
      'settings.sectionLabel': 'Tacit',
      'panel.title': 'Tacit',
      'panel.coached': 'Analyzed prompts',
      'panel.coachedEmpty': 'No analyzed prompts yet — tick prompts in the Tacit tab of a conversation and click "Analyze selected".',
      'panel.hint': 'To pick prompts: open any conversation and click the "Tacit" tab.',
      'settings.model': 'Analysis model',
      'settings.live': 'Enable the composer Improve button',
      'settings.apply': 'Apply',
      'settings.clear': 'Clear all analysis reports (every session)',
      'settings.cleared': 'Cleared {n} report(s)',
      'settings.close': 'Collapse',
      empty: 'After you send a message, each turn\'s trajectory digest appears here — tick the prompts you want analyzed, then click "Analyze selected".',
      'coach.selected': 'Analyze selected ({n})',
      'coach.select': 'Select prompts…',
      'coach.selectDone': 'Done selecting',
      'manual.hint': 'Think a prompt was weak even though the turn went fine? Analyze it manually — one small call.',
      'turn.interrupted': 'interrupted',
      'turn.report': 'Report',
      'coach.batchRunning': 'Analyzing…',
      'turn.select': 'Select this prompt to analyze',
      'turn.tools': '{n} tool calls',
      'turn.steps': '{n} steps',
      'turn.tokens': '≈{n} tokens',
      'turn.retries': 'retries {n}',
      'turn.expand': 'Expand',
      'turn.collapse': 'Collapse',
      'turn.analyze': 'Analyze',
      'turn.analyzing': 'Analyzing…',
      'turn.reanalyze': 'Re-analyze',
      'turn.running': 'In progress',
      'report.problems': 'Problems found',
      'report.improved': 'Improved prompt',
      'report.explanation': 'Explanation',
      'report.copy': 'Copy',
      'report.copied': 'Copied',
      'report.emptyImproved': '(the model returned no rewrite)',
      'sev.high': 'High',
      'sev.medium': 'Medium',
      'sev.low': 'Low',
      'sev.info': 'Note',
      'improve.btn': 'Improve prompt',
      'preview.title': 'Improvement preview',
      'preview.original': 'Original',
      'preview.improved': 'Improved',
      'preview.rationale': 'What changed',
      'preview.pending': 'Analyzing your draft…',
      'preview.apply': 'Apply improvement',
      'preview.cancel': 'Cancel',
      'feedback.title': 'Was this better?',
      'feedback.up': 'Yes',
      'feedback.down': 'No',
      'feedback.reasonPlaceholder': 'What was wrong? (one line)',
      'feedback.send': 'Send feedback',
      'feedback.noted': 'Noted — thanks!',
      'panel.styleRules': 'Learned style rules',
      'panel.styleRulesEmpty': 'No style rules yet — apply an improvement and rate it 👎 with a one-line reason; after 3, Tacit distills durable rules from them.',
      'err.bad-request': 'Invalid request.',
      'err.bad-json': 'Invalid request body.',
      'err.no-session': 'The session is not available (it may not be restored in this process).',
      'err.not-retained': 'This turn is outside the retained history window and cannot be analyzed.',
      'err.busy': 'An analysis for this turn is already running.',
      'err.no-llm': 'The model service is unavailable.',
      'err.no-api-key': 'The DeepSeek API key is missing or invalid (configure it in Settings → Models).',
      'err.rate-limited': 'The request was rate-limited; try again shortly.',
      'err.timeout': 'The model call timed out; please retry.',
      'err.empty-response': 'The model returned no content; please retry.',
      'err.call-failed': 'The model call failed: {detail}',
      'err.network': 'Could not reach the Tacit service.',
      'err.internal': 'Internal error: {detail}',
      'err.continuation': 'This is a bare continuation ("continue", "go ahead") with nothing to analyze — analyze the turn before it instead.',
    }

    // ── API client (the host half's own routes on the harness origin) ──────

    async function api(pathName, payload) {
      const response = await fetch('/api/tacit' + pathName, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload === undefined ? {} : payload),
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        // Server envelopes carry a code (forbidden, bad-request, internal…);
        // surface it so the dictionary can explain instead of a generic "network".
        const error = new Error('http ' + String(response.status))
        error.code = data !== null && typeof data === 'object' && typeof data.code === 'string' && data.code.length > 0 ? data.code : 'network'
        error.detail = data !== null && typeof data === 'object' && typeof data.detail === 'string' ? data.detail : ''
        throw error
      }
      if (data === null || typeof data !== 'object') throw new Error('bad response')
      return data
    }

    /** {code, detail} for the UI from any thrown value (network failures → 'network'). */
    function errorOf(error) {
      return {
        code: error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : 'network',
        detail: error !== null && typeof error === 'object' && typeof error.detail === 'string' ? error.detail : '',
      }
    }

    // ── Shared per-session store (tab + composer button + preview) ─────────

    function createSessionStore(sessionId) {
      return {
        sessionId,
        config: null,
        profile: null,
        auto: null, // {today, budget}
        bootstrap: null, // {running, done, total}
        reports: {},
        inFlight: {}, // String(turn) -> true
        selection: new Set(), // turn numbers ticked for batch analysis
        selecting: false, // selection mode (checkboxes + batch button) shown?
        expanded: new Set(), // turn numbers whose report is unfolded
        batchRunning: false,
        preview: { open: false, pending: false, original: '', data: null, error: null },
        // Feedback strip state for the last APPLIED improve response:
        // {open, verdict: null|'up'|'down', reason, sending, noted, rewriteId, fading}
        feedback: { open: false, verdict: null, reason: '', sending: false, noted: false, rewriteId: null, fading: false },
        error: null, // transient {code, detail} for the tab
        notice: null, // transient {code} after a successful settings action
        initStarted: false,
        initDone: false,
        listeners: new Set(),
      }
    }

    const sessionStores = new Map()
    function storeFor(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      let store = sessionStores.get(sessionId)
      if (store === undefined) {
        store = createSessionStore(sessionId)
        sessionStores.set(sessionId, store)
      }
      return store
    }

    function notify(store) {
      for (const listener of store.listeners) listener()
    }

    function useStoreVersion(store) {
      const [version, setVersion] = useState(0)
      useEffect(() => {
        if (store === null) return undefined
        const listener = () => setVersion((value) => value + 1)
        store.listeners.add(listener)
        return () => {
          store.listeners.delete(listener)
        }
      }, [store])
      return version
    }

    // ── Root store (sidebar action + settings section + frame overlay) ─────

    const rootStore = {
      config: null,
      profile: null,
      auto: null,
      steering: null, // {enabled, text}
      trend: null, // measured early-vs-recent trend
      bootstrap: null, // {running, done, total}
      coached: [], // cross-session coached-prompt entries
      initStarted: false,
      initDone: false,
      error: null,
      listeners: new Set(),
    }

    function notifyRoot() {
      for (const listener of rootStore.listeners) listener()
    }

    function useRootVersion() {
      const [version, setVersion] = useState(0)
      useEffect(() => {
        const listener = () => setVersion((value) => value + 1)
        rootStore.listeners.add(listener)
        return () => {
          rootStore.listeners.delete(listener)
        }
      }, [])
      return version
    }

    async function initRootStore() {
      if (rootStore.initStarted) return
      rootStore.initStarted = true
      try {
        const state = await api('/state', {})
        if (state !== null && typeof state === 'object') {
          rootStore.config = state.config !== null && typeof state.config === 'object' ? state.config : null
          rootStore.profile = state.profile !== null && typeof state.profile === 'object' ? state.profile : null
          rootStore.auto = state.auto !== null && typeof state.auto === 'object' ? state.auto : null
          rootStore.steering = state.steering !== null && typeof state.steering === 'object' ? state.steering : null
          rootStore.bootstrap = state.bootstrap !== null && typeof state.bootstrap === 'object' ? state.bootstrap : null
        }
        const coached = await api('/history', { limit: 50 })
        if (coached !== null && typeof coached === 'object' && coached.ok && Array.isArray(coached.entries)) {
          rootStore.coached = coached.entries
        }
        const stats = await api('/stats', {})
        if (stats !== null && typeof stats === 'object' && stats.ok && stats.trend !== null && typeof stats.trend === 'object') {
          rootStore.trend = stats.trend
        }
        rootStore.initDone = true
      } catch (error) {
        rootStore.error = errorOf(error)
        rootStore.initDone = true
      }
      notifyRoot()
    }

    /** Re-fetch profile/config so freshly distilled style rules show up. */
    async function refreshRootState() {
      try {
        const state = await api('/state', {})
        if (state !== null && typeof state === 'object') {
          rootStore.config = state.config !== null && typeof state.config === 'object' ? state.config : null
          rootStore.profile = state.profile !== null && typeof state.profile === 'object' ? state.profile : null
          rootStore.auto = state.auto !== null && typeof state.auto === 'object' ? state.auto : null
          rootStore.steering = state.steering !== null && typeof state.steering === 'object' ? state.steering : null
          rootStore.bootstrap = state.bootstrap !== null && typeof state.bootstrap === 'object' ? state.bootstrap : null
        }
      } catch {
        // Stale view beats a broken panel.
      }
      notifyRoot()
    }

    async function updateRootConfig(patch) {
      rootStore.error = null
      try {
        const result = await api('/config', { patch })
        if (result !== null && typeof result === 'object' && result.ok && result.config !== null && typeof result.config === 'object') {
          rootStore.config = result.config
        } else {
          rootStore.error = {
            code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request',
            detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
          }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      notifyRoot()
    }

    async function clearAllRoot() {
      rootStore.error = null
      try {
        const result = await api('/clear', {})
        if (result !== null && typeof result === 'object' && result.ok) {
          rootStore.coached = []
        } else {
          rootStore.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request', detail: '' }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      notifyRoot()
    }

    /** Poll /state while a bootstrap runs so the counter moves; `apply` receives each snapshot. */
    function pollBootstrap(apply) {
      const tick = async () => {
        try {
          const state = await api('/state', {})
          const running = state !== null && typeof state === 'object' && state.bootstrap !== null && typeof state.bootstrap === 'object' && state.bootstrap.running === true
          apply(state)
          if (running) setTimeout(tick, 2000)
        } catch {
          // Give up quietly; the final response of the bootstrap call still lands.
        }
      }
      setTimeout(tick, 1500)
    }

    async function bootstrapSession(store) {
      if (store.bootstrap !== null && typeof store.bootstrap === 'object' && store.bootstrap.running) return
      store.bootstrap = { running: true, done: 0, total: 0 }
      store.error = null
      notify(store)
      pollBootstrap((state) => {
        if (state !== null && typeof state === 'object' && state.bootstrap !== null && typeof state.bootstrap === 'object') store.bootstrap = state.bootstrap
        notify(store)
      })
      try {
        const result = await api('/bootstrap', { sessionId: store.sessionId, limit: 20 })
        if (!(result !== null && typeof result === 'object' && result.ok)) {
          store.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed', detail: '' }
        }
        const reports = await api('/reports', { sessionId: store.sessionId })
        if (reports !== null && typeof reports === 'object' && reports.ok && reports.reports !== null && typeof reports.reports === 'object') store.reports = reports.reports
        const state = await api('/state', {})
        if (state !== null && typeof state === 'object') {
          store.profile = state.profile !== null && typeof state.profile === 'object' ? state.profile : store.profile
          store.bootstrap = state.bootstrap !== null && typeof state.bootstrap === 'object' ? state.bootstrap : null
        }
      } catch (error) {
        store.error = errorOf(error)
        store.bootstrap = null
      }
      notify(store)
    }

    async function bootstrapAll() {
      if (rootStore.bootstrap !== null && typeof rootStore.bootstrap === 'object' && rootStore.bootstrap.running) return
      rootStore.bootstrap = { running: true, done: 0, total: 0 }
      rootStore.error = null
      notifyRoot()
      pollBootstrap((state) => {
        if (state !== null && typeof state === 'object' && state.bootstrap !== null && typeof state.bootstrap === 'object') rootStore.bootstrap = state.bootstrap
        notifyRoot()
      })
      try {
        const result = await api('/bootstrap', { limit: 20 })
        if (!(result !== null && typeof result === 'object' && result.ok)) {
          rootStore.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed', detail: '' }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      rootStore.initStarted = false
      rootStore.initDone = false
      await initRootStore()
    }

    async function editDirectives(payload) {
      rootStore.error = null
      try {
        const result = await api('/directives', payload)
        if (result !== null && typeof result === 'object' && result.ok) {
          if (result.profile !== null && typeof result.profile === 'object') rootStore.profile = result.profile
          if (result.steering !== null && typeof result.steering === 'object') rootStore.steering = result.steering
        } else {
          rootStore.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request', detail: '' }
        }
      } catch (error) {
        rootStore.error = errorOf(error)
      }
      notifyRoot()
    }

    async function initStore(store) {
      if (store === null || store.initStarted) return
      store.initStarted = true
      try {
        const state = await api('/state', {})
        if (state !== null && typeof state === 'object') {
          store.config = state.config !== null && typeof state.config === 'object' ? state.config : null
          store.profile = state.profile !== null && typeof state.profile === 'object' ? state.profile : null
          store.auto = state.auto !== null && typeof state.auto === 'object' ? state.auto : null
          store.bootstrap = state.bootstrap !== null && typeof state.bootstrap === 'object' ? state.bootstrap : null
        }
        const reports = await api('/reports', { sessionId: store.sessionId })
        if (reports !== null && typeof reports === 'object' && reports.ok && reports.reports !== null && typeof reports.reports === 'object') {
          store.reports = reports.reports
        }
        store.initDone = true
      } catch (error) {
        store.error = errorOf(error)
        store.initDone = true
      }
      notify(store)
    }

    function analyzeTurn(store, turn) {
      if (store.inFlight[String(turn)]) return
      store.inFlight[String(turn)] = true
      store.expanded.add(turn)
      store.error = null
      notify(store)
      api('/analyze', { sessionId: store.sessionId, turn })
        .then((result) => {
          if (result !== null && typeof result === 'object' && result.ok && result.report !== null && typeof result.report === 'object') {
            store.reports[String(turn)] = result.report
            store.error = null
          } else {
            store.error = {
              code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed',
              detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
            }
          }
          if (result !== null && typeof result === 'object' && result.profile !== null && typeof result.profile === 'object') {
            store.profile = result.profile
          }
        })
        .catch((error) => {
          store.error = errorOf(error)
        })
        .finally(() => {
          delete store.inFlight[String(turn)]
          notify(store)
        })
    }

    /** Run one /analyze call and settle when it finishes (batch building block). */
    function analyzeTurnAsync(store, turn) {
      return new Promise((resolve) => {
        store.inFlight[String(turn)] = true
        notify(store)
        api('/analyze', { sessionId: store.sessionId, turn })
          .then((result) => {
            if (result !== null && typeof result === 'object' && result.ok && result.report !== null && typeof result.report === 'object') {
              store.reports[String(turn)] = result.report
              store.selection.delete(turn)
              store.expanded.add(turn)
              store.error = null
            } else {
              store.error = {
                code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed',
                detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
              }
            }
            if (result !== null && typeof result === 'object' && result.profile !== null && typeof result.profile === 'object') {
              store.profile = result.profile
            }
          })
          .catch((error) => {
            store.error = errorOf(error)
          })
          .finally(() => {
            delete store.inFlight[String(turn)]
            notify(store)
            resolve()
          })
      })
    }

    /** Coach every ticked prompt sequentially (the user-chosen 20). */
    async function coachSelected(store) {
      if (store.batchRunning) return
      const turns = [...store.selection].sort((a, b) => a - b)
      if (turns.length === 0) return
      store.batchRunning = true
      store.error = null
      notify(store)
      for (const turn of turns) {
        if (store.inFlight[String(turn)]) continue
        await analyzeTurnAsync(store, turn)
      }
      store.batchRunning = false
      store.selecting = false
      notify(store)
    }

    function toggleSelecting(store) {
      store.selecting = !store.selecting
      if (!store.selecting) store.selection.clear()
      notify(store)
    }

    function toggleReport(store, turn) {
      if (store.expanded.has(turn)) store.expanded.delete(turn)
      else store.expanded.add(turn)
      notify(store)
    }

    function improveDraft(store, draft) {
      if (store.preview.open || typeof draft !== 'string' || draft.trim().length === 0) return
      store.preview = { open: true, pending: true, original: draft, data: null, error: null }
      notify(store)
      api('/improve', { sessionId: store.sessionId, draft })
        .then((result) => {
          if (result !== null && typeof result === 'object' && result.ok && typeof result.improved === 'string' && result.improved.trim().length > 0) {
            store.preview = { ...store.preview, pending: false, data: result }
          } else {
            store.preview = {
              ...store.preview,
              pending: false,
              error: {
                code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'call-failed',
                detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
              },
            }
          }
        })
        .catch((error) => {
          store.preview = { ...store.preview, pending: false, error: errorOf(error) }
        })
        .finally(() => notify(store))
    }

    /** Is the live improve feature enabled for this store? (No learning gate.) */
    function storeReady(store) {
      if (store === null || !store.initDone) return false
      const config = configOf(store.config)
      return config !== null && config.liveSuggestions !== false
    }

    function applyImproved(store, inputActions) {
      const data = store.preview.data
      if (data !== null && typeof data === 'object' && typeof data.improved === 'string'
        && inputActions !== undefined && inputActions !== null && typeof inputActions.setDraft === 'function') {
        inputActions.setDraft(data.improved)
      }
      // The feedback strip rides every applied rewrite while the feature is on.
      const rewriteId = data !== null && typeof data === 'object' && typeof data.rewriteId === 'string' && data.rewriteId.length > 0
        ? data.rewriteId
        : null
      if (storeReady(store) && rewriteId !== null) {
        store.feedback = { open: true, verdict: null, reason: '', sending: false, noted: false, rewriteId, fading: false }
        // Free bookkeeping on an existing call: host bumps `applied` and
        // captures the verification baseline for the next finished turn.
        api('/applied', { sessionId: store.sessionId, rewriteId }).catch(() => {})
      } else {
        store.feedback = { ...store.feedback, open: false }
      }
      store.preview = { open: false, pending: false, original: '', data: null, error: null }
      notify(store)
    }

    function closeFeedback(store) {
      store.feedback = { open: false, verdict: null, reason: '', sending: false, noted: false, rewriteId: null, fading: false }
      notify(store)
    }

    /** The strip fades out after the next send (observed via the input machine phase). */
    function fadeFeedback(store) {
      if (!store.feedback.open || store.feedback.fading) return
      store.feedback = { ...store.feedback, fading: true }
      notify(store)
      setTimeout(() => {
        if (store.feedback.open && store.feedback.fading) closeFeedback(store)
      }, 350)
    }

    /** 👍 posts immediately; 👎 expands the one-line reason field first. */
    function voteFeedback(store, verdict) {
      if (!store.feedback.open || store.feedback.sending || store.feedback.rewriteId === null) return
      if (verdict === 'down') {
        store.feedback = { ...store.feedback, verdict: 'down' }
        notify(store)
        return
      }
      sendFeedback(store, 'up')
    }

    function sendFeedback(store, verdict) {
      if (!store.feedback.open || store.feedback.sending || store.feedback.rewriteId === null) return
      const reason = verdict === 'down' ? store.feedback.reason.trim() : ''
      if (verdict === 'down' && reason.length === 0) return
      store.feedback = { ...store.feedback, sending: true }
      notify(store)
      const payload = { rewriteId: store.feedback.rewriteId, verdict }
      if (verdict === 'down') payload.reason = reason.slice(0, 300)
      api('/feedback', payload)
        .then((result) => {
          if (result !== null && typeof result === 'object' && result.ok && result.profile !== null && typeof result.profile === 'object') {
            store.profile = result.profile
            store.feedback = { ...store.feedback, sending: false, noted: true }
            notify(store)
            setTimeout(() => {
              if (store.feedback.noted) closeFeedback(store)
            }, 1500)
          } else {
            closeFeedback(store)
          }
        })
        .catch(() => closeFeedback(store))
    }

    function closePreview(store) {
      store.preview = { open: false, pending: false, original: '', data: null, error: null }
      notify(store)
    }

    async function updateConfig(store, patch) {
      try {
        const result = await api('/config', { patch })
        if (result !== null && typeof result === 'object' && result.ok && result.config !== null && typeof result.config === 'object') {
          store.config = result.config
        } else {
          store.error = {
            code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request',
            detail: result !== null && typeof result === 'object' && typeof result.detail === 'string' ? result.detail : '',
          }
        }
      } catch (error) {
        store.error = errorOf(error)
      }
      notify(store)
    }

    async function clearReports(store) {
      store.error = null
      try {
        const result = await api('/clear', {})
        if (result !== null && typeof result === 'object' && result.ok) {
          store.reports = {}
          store.notice = { code: 'settings.cleared', n: typeof result.removed === 'number' ? result.removed : 0 }
        } else {
          store.error = { code: result !== null && typeof result === 'object' && typeof result.code === 'string' ? result.code : 'bad-request', detail: '' }
        }
      } catch (error) {
        store.error = errorOf(error)
      }
      notify(store)
    }

    // ── Formatting & defensive narrowing ───────────────────────────────────

    function fmt(n) {
      const value = Number(n)
      if (!Number.isFinite(value)) return '—'
      const sign = value < 0 ? '-' : ''
      const abs = Math.abs(value)
      if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + 'M'
      if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'k'
      return sign + String(Math.round(abs))
    }

    function fmtTime(ms) {
      const date = new Date(Number(ms))
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleTimeString('en-GB', { hour12: false })
    }

    function turnsOf(value) {
      if (value === null || typeof value !== 'object' || !Array.isArray(value.turns)) return []
      return value.turns.filter((turn) => turn !== null && typeof turn === 'object' && typeof turn.turn === 'number')
    }

    function profileOf(value) {
      if (value === null || typeof value !== 'object') return null
      return {
        analyzedCount: typeof value.analyzedCount === 'number' ? value.analyzedCount : 0,
      }
    }

    function configOf(value) {
      if (value === null || typeof value !== 'object') return null
      return value
    }

    function reportOf(value) {
      if (value === null || typeof value !== 'object') return null
      const problems = Array.isArray(value.problems)
        ? value.problems.filter((p) => p !== null && typeof p === 'object')
        : []
      return {
        ok: value.ok === true,
        turn: typeof value.turn === 'number' ? value.turn : 0,
        model: typeof value.model === 'string' ? value.model : '',
        problems,
        improvedPrompt: typeof value.improvedPrompt === 'string' ? value.improvedPrompt : '',
        explanation: typeof value.explanation === 'string' ? value.explanation : '',
        trigger: value.trigger === 'auto' || value.trigger === 'correction' || value.trigger === 'bootstrap' ? value.trigger : 'manual',
        followUp: typeof value.followUp === 'string' ? value.followUp : '',
      }
    }

    function copyText(text) {
      if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
        return
      }
      fallbackCopy(text)
    }

    function fallbackCopy(text) {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      } catch {
        // Clipboard unavailable; the text remains selectable in the card.
      }
    }

    // ── Components ─────────────────────────────────────────────────────────

    function makeKit(t) {
      return { t, fmt, fmtTime }
    }

    /** "Learned from N prompts · Auto-learning on · x/y today" status card. */
    /** "Learn from my last 20 turns" — spinner label while a bootstrap runs. */
    function BootstrapButton(kit, { bootstrap, onClick }) {
      const { t } = kit
      const running = bootstrap !== null && bootstrap !== undefined && typeof bootstrap === 'object' && bootstrap.running === true
      return h('span', { className: 'tacit-bootstrap' },
        h('button', {
          type: 'button',
          className: 'tacit-btn tacit-btn-sm',
          disabled: running,
          title: t('bootstrap.hint'),
          onClick,
        }, running
          ? t('bootstrap.running', { done: String(typeof bootstrap.done === 'number' ? bootstrap.done : 0), total: String(typeof bootstrap.total === 'number' ? bootstrap.total : 0) })
          : t('bootstrap.btn')))
    }

    function pct(value) {
      return String(Math.round((Number(value) || 0) * 100)) + '%'
    }

    function StatusCard(kit, { config, profile, auto, trend }) {
      const { t } = kit
      const hasTrend = trend !== null && trend !== undefined && typeof trend === 'object' && trend.enough === true
        && trend.early !== null && typeof trend.early === 'object' && trend.recent !== null && typeof trend.recent === 'object'
      const analyzed = profile !== null ? profile.analyzedCount : 0
      const autoOn = config !== null && config.autoAnalyze !== false
      const today = auto !== null && typeof auto === 'object' && typeof auto.today === 'number' ? auto.today : 0
      const budget = auto !== null && typeof auto === 'object' && typeof auto.budget === 'number'
        ? auto.budget
        : (config !== null && typeof config.autoDailyBudget === 'number' ? config.autoDailyBudget : 30)
      return h('div', { className: 'tacit-progress' },
        h('div', { className: 'tacit-progress-head' },
          h('span', { className: 'tacit-progress-title' }, t('status.learned', { count: String(analyzed) })),
          h('span', { className: 'tacit-progress-count' }, autoOn ? t('status.autoOn', { today: String(today), budget: String(budget) }) : '')),
        h('div', { className: 'tacit-progress-text' }, autoOn ? t('status.autoHint') : t('status.autoOff')),
        hasTrend
          ? h('div', { className: 'tacit-trend' },
            h('span', { className: 'tacit-chip' }, t('status.trendMessy', { a: pct(trend.early.messyRate), b: pct(trend.recent.messyRate) })),
            h('span', { className: 'tacit-chip' }, t('status.trendTokens', { a: fmt(trend.early.tokensPerTurn), b: fmt(trend.recent.tokensPerTurn) })),
            h('span', { className: 'tacit-progress-text' }, t('status.trendHint', { n: String(trend.window) })))
          : null)
    }

    function ProblemRow(kit, problem, index) {
      const { t } = kit
      const severity = String(problem.severity === 'high' || problem.severity === 'medium' || problem.severity === 'low' ? problem.severity : 'info')
      const sevClass = 'tacit-sev-' + (severity === 'info' ? 'info' : severity)
      return h('div', { key: 'p' + index, className: 'tacit-problem' },
        h('div', { className: 'tacit-problem-head' },
          h('span', { className: 'tacit-problem-kind' }, String(problem.kind || 'general')),
          h('span', { className: 'tacit-problem-sev ' + sevClass }, t('sev.' + severity))),
        h('div', { className: 'tacit-problem-what' }, String(problem.what || '')),
        h('div', { className: 'tacit-problem-why' }, String(problem.why || '')))
    }

    function ReportCard(props) {
      const { kit, report } = props
      const { t } = kit
      const [copied, setCopied] = useState(false)
      if (report === null) return null
      const improved = report.improvedPrompt
      const onCopy = () => {
        copyText(improved)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
      return h('div', { className: 'tacit-report' },
        h('div', { className: 'tacit-report-title' },
          t('report.problems'),
          ' ',
          h('span', { className: 'tacit-chip tacit-chip-trigger' }, t('trigger.' + report.trigger))),
        report.problems.length === 0
          ? h('div', { className: 'tacit-report-note' }, '—')
          : report.problems.map((problem, index) => ProblemRow(kit, problem, index)),
        h('div', { className: 'tacit-report-title' }, t('report.improved')),
        improved.length > 0
          ? h('div', { className: 'tacit-report-improved' },
            h('div', { className: 'tacit-report-actions' },
              h('button', {
                type: 'button',
                className: 'tacit-btn tacit-btn-sm',
                onClick: onCopy,
              }, copied ? t('report.copied') : t('report.copy'))),
            h('div', { className: 'tacit-report-body' },
              MarkdownText !== null
                ? h(MarkdownText, { text: improved })
                : h('pre', { className: 'tacit-pre' }, improved)))
          : h('div', { className: 'tacit-report-note' }, t('report.emptyImproved')),
        typeof report.explanation === 'string' && report.explanation.length > 0
          ? h('div', null,
            h('div', { className: 'tacit-report-title' }, t('report.explanation')),
            h('div', { className: 'tacit-report-body' },
              MarkdownText !== null
                ? h(MarkdownText, { text: report.explanation })
                : h('pre', { className: 'tacit-pre' }, report.explanation)))
          : null)
    }

    function TurnRow(props) {
      const { kit, store, turn, isNewest } = props
      const { t, fmtTime } = kit
      const [expanded, setExpanded] = useState(false)
      const analyzing = store.inFlight[String(turn.turn)] === true
      const report = reportOf(store.reports[String(turn.turn)])
      const selected = store.selection.has(turn.turn)
      const reportOpen = store.expanded.has(turn.turn)
      const usage = turn.usage !== null && typeof turn.usage === 'object' ? turn.usage : {}
      const tokens = (typeof usage.inputTokens === 'number' ? usage.inputTokens : 0)
        + (typeof usage.outputTokens === 'number' ? usage.outputTokens : 0)
      const tools = Array.isArray(turn.toolCalls) ? turn.toolCalls.length : 0
      const prompt = typeof turn.prompt === 'string' ? turn.prompt : ''
      const promptPreview = prompt.length > 120 ? prompt.slice(0, 120) + '…' : prompt

      const toggleSelected = () => {
        if (selected) store.selection.delete(turn.turn)
        else store.selection.add(turn.turn)
        notify(store)
      }

      // A turn without turn/end is live only when it is the newest one; an
      // older unfinished turn belonged to a session that was interrupted.
      const status = turn.finished === true
        ? null
        : (isNewest === true
          ? h('span', { className: 'tacit-row-live' }, t('turn.running'))
          : h('span', { className: 'tacit-chip tacit-chip-muted' }, t('turn.interrupted')))

      return h('div', { className: 'tacit-row' + (report !== null ? ' tacit-row-analyzed' : '') },
        h('div', { className: 'tacit-row-head' },
          store.selecting
            ? h('input', {
              type: 'checkbox',
              className: 'tacit-check',
              checked: selected,
              title: t('turn.select'),
              onChange: toggleSelected,
            })
            : null,
          h('div', { className: 'tacit-row-heading' },
            h('span', { className: 'tacit-row-turn' }, '# ' + String(turn.turn)),
            h('span', { className: 'tacit-row-time' }, fmtTime(turn.startedAt)),
            report !== null ? h('span', { className: 'tacit-chip tacit-chip-trigger' }, t('trigger.' + report.trigger)) : null,
            status),
          h('div', { className: 'tacit-row-chips' },
            h('span', { className: 'tacit-chip' }, t('turn.tools', { n: String(tools) })),
            h('span', { className: 'tacit-chip' }, t('turn.steps', { n: String(typeof turn.steps === 'number' ? turn.steps : 0) })),
            h('span', { className: 'tacit-chip' }, t('turn.tokens', { n: fmt(tokens) })),
            typeof turn.retries === 'number' && turn.retries > 0
              ? h('span', { className: 'tacit-chip tacit-chip-warn' }, t('turn.retries', { n: String(turn.retries) }))
              : null,
            report !== null
              ? h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => toggleReport(store, turn.turn) },
                t('turn.report') + (reportOpen ? ' ▾' : ' ▸'))
              : null,
            h('button', {
              type: 'button',
              className: 'tacit-btn tacit-btn-sm tacit-btn-quiet',
              disabled: analyzing,
              onClick: () => analyzeTurn(store, turn.turn),
            }, analyzing ? t('turn.analyzing') : (report !== null ? t('turn.reanalyze') : t('turn.analyze'))))),
        prompt.length > 0
          ? h('div', { className: 'tacit-row-prompt' },
            h('button', {
              type: 'button',
              className: 'tacit-row-prompt-text',
              onClick: () => setExpanded((open) => !open),
            }, expanded ? prompt : promptPreview),
            prompt.length > 120
              ? h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => setExpanded((open) => !open) },
                expanded ? t('turn.collapse') : t('turn.expand'))
              : null)
          : null,
        typeof turn.enrichment === 'string' && turn.enrichment.length > 0
          ? h('div', { className: 'tacit-row-enrichment' },
            h('span', { className: 'tacit-report-title' }, t('turn.enrichment')),
            h('div', { className: 'tacit-pre' }, turn.enrichment))
          : null,
        report !== null && reportOpen ? h(ReportCard, { kit, report }) : null)
    }

    function SettingsPanel(props) {
      const { kit, store } = props
      const { t } = kit
      const config = configOf(store.config)
      const [model, setModel] = useState(config !== null && typeof config.model === 'string' ? config.model : 'deepseek-v4-flash')
      const [budgetText, setBudgetText] = useState(config !== null && typeof config.autoDailyBudget === 'number' ? String(config.autoDailyBudget) : '30')
      const [auto, setAuto] = useState(config !== null && config.autoAnalyze !== false)
      const [live, setLive] = useState(config !== null && config.liveSuggestions !== false)
      const [notice, setNotice] = useState(null)

      useEffect(() => {
        if (config !== null) {
          if (typeof config.model === 'string') setModel(config.model)
          if (typeof config.autoDailyBudget === 'number') setBudgetText(String(config.autoDailyBudget))
          if (typeof config.autoAnalyze === 'boolean') setAuto(config.autoAnalyze)
          if (typeof config.liveSuggestions === 'boolean') setLive(config.liveSuggestions)
        }
      }, [config])

      const applyModel = (value) => {
        setModel(value)
        updateConfig(store, { model: value })
      }
      const applyBudget = () => {
        const number = Math.max(0, Math.min(1000, Math.round(Number(budgetText) || 0)))
        setBudgetText(String(number))
        updateConfig(store, { autoDailyBudget: number })
      }
      const toggleAuto = () => {
        const next = !auto
        setAuto(next)
        updateConfig(store, { autoAnalyze: next })
      }
      const toggleLive = () => {
        const next = !live
        setLive(next)
        updateConfig(store, { liveSuggestions: next })
      }
      const onClear = async () => {
        await clearReports(store)
        if (store.notice !== null && store.notice.code === 'settings.cleared') {
          setNotice(t(store.notice.code, { n: String(store.notice.n) }))
          setTimeout(() => setNotice(null), 3000)
        }
      }

      return h('div', { className: 'tacit-settings' },
        h('div', { className: 'tacit-settings-title' }, t('settings.title')),
        h('div', { className: 'tacit-settings-row' },
          h('label', { className: 'tacit-settings-label' }, t('settings.model')),
          h('select', {
            className: 'tacit-select',
            value: model,
            onChange: (event) => applyModel(event.target.value),
          },
          h('option', { value: 'deepseek-v4-flash' }, 'deepseek-v4-flash'),
          h('option', { value: 'deepseek-v4-pro' }, 'deepseek-v4-pro'))),
        h('div', { className: 'tacit-settings-row' },
          h('label', { className: 'tacit-settings-label' }, t('settings.auto')),
          h('input', { type: 'checkbox', checked: auto, onChange: toggleAuto })),
        h('div', { className: 'tacit-settings-row' },
          h('label', { className: 'tacit-settings-label' }, t('settings.budget')),
          h('input', {
            className: 'tacit-input',
            type: 'number',
            min: 0,
            value: budgetText,
            onChange: (event) => setBudgetText(event.target.value),
          }),
          h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: applyBudget }, t('settings.apply'))),
        h('div', { className: 'tacit-settings-row' },
          h('label', { className: 'tacit-settings-label' }, t('settings.live')),
          h('input', { type: 'checkbox', checked: live, onChange: toggleLive })),
        h('div', { className: 'tacit-settings-row' },
          h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: onClear }, t('settings.clear')),
          notice !== null ? h('span', { className: 'tacit-settings-notice' }, notice) : null))
    }

    function CoachTab(kit) {
      const { t } = kit
      return function CoachTabView(props) {
        const sessionId = props.sessionId
        const store = storeFor(sessionId)
        useStoreVersion(store)
        useEffect(() => {
          if (store !== null) initStore(store)
        }, [store])
        const [settingsOpen, setSettingsOpen] = useState(false)

        if (store === null) {
          return h('div', { className: 'tacit-root' }, h('div', { className: 'tacit-empty' }, t('err.no-session')))
        }

        const rawTurns = typeof props.useProjection === 'function' ? props.useProjection('tacitTimeline') : undefined
        const turns = turnsOf(rawTurns).slice().reverse()
        const config = configOf(store.config)
        const profile = profileOf(store.profile)
        const selectedCount = store.selection.size
        const error = store.error

        return h('div', { className: 'tacit-root' },
          h('div', { className: 'tacit-head' },
            h('div', { className: 'tacit-head-title' }, t('tab')),
            h('button', {
              type: 'button',
              className: 'tacit-btn',
              onClick: () => setSettingsOpen((open) => !open),
            }, settingsOpen ? t('settings.close') : t('settings'))),
          StatusCard(kit, { config, profile, auto: store.auto }),
          settingsOpen ? h(SettingsPanel, { kit, store }) : null,
          error !== null && typeof error === 'object'
            ? h('div', { className: 'tacit-error' }, t('err.' + String(error.code), { detail: String(error.detail || '') }))
            : null,
          turns.length === 0
            ? h('div', { className: 'tacit-empty' }, t('empty'))
            : h('div', null,
              h('div', { className: 'tacit-toolbar' },
                h('span', { className: 'tacit-panel-hint tacit-toolbar-hint' }, t('manual.hint')),
                BootstrapButton(kit, { bootstrap: store.bootstrap, onClick: () => bootstrapSession(store) }),
                h('button', {
                  type: 'button',
                  className: 'tacit-btn tacit-btn-sm',
                  onClick: () => toggleSelecting(store),
                }, store.selecting ? t('coach.selectDone') : t('coach.select')),
                store.selecting
                  ? h('button', {
                    type: 'button',
                    className: 'tacit-btn tacit-btn-sm tacit-btn-primary',
                    disabled: selectedCount === 0 || store.batchRunning,
                    onClick: () => coachSelected(store),
                  }, store.batchRunning ? t('coach.batchRunning') : t('coach.selected', { n: String(selectedCount) }))
                  : null),
              turns.map((turn, index) => h(TurnRow, { key: String(turn.turn), kit, store, turn, isNewest: index === 0 }))))
      }
    }

    function ImproveButton(kit) {
      const { t } = kit
      return function ImproveButtonView(props) {
        const sessionId = props.sessionId
        const store = storeFor(sessionId)
        useStoreVersion(store)
        useEffect(() => {
          if (store !== null) initStore(store)
        }, [store])

        if (!storeReady(store)) return null

        const draft = props.input !== null && typeof props.input === 'object' && typeof props.input.draft === 'string'
          ? props.input.draft
          : ''

        return h('button', {
          type: 'button',
          className: 'tacit-improve-btn',
          title: t('improve.btn'),
          onClick: () => improveDraft(store, draft),
        }, '✨ ' + t('improve.btn'))
      }
    }

    function PreviewOverlay(kit) {
      const { t } = kit
      return function PreviewOverlayView(props) {
        const store = props.tacitStore !== null && typeof props.tacitStore === 'object'
          ? props.tacitStore
          : null
        useStoreVersion(store)
        if (store === null || !store.preview.open) return null

        const preview = store.preview
        const onApply = () => applyImproved(store, props.inputActions)
        const onCancel = () => closePreview(store)

        return h('div', { className: 'tacit-modal-backdrop' },
          h('div', { className: 'tacit-modal-card' },
            h('div', { className: 'tacit-modal-head' },
              h('span', { className: 'tacit-modal-title' }, t('preview.title')),
              h('button', { type: 'button', className: 'tacit-modal-close', onClick: onCancel }, '×')),
            preview.pending
              ? h('div', { className: 'tacit-modal-pending' }, t('preview.pending'))
              : preview.error !== null
                ? h('div', { className: 'tacit-error' },
                  t('err.' + String(preview.error.code), { detail: String(preview.error.detail || '') }))
                : h('div', null,
                  h('div', { className: 'tacit-modal-cols' },
                    h('div', { className: 'tacit-modal-col' },
                      h('div', { className: 'tacit-modal-col-title' }, t('preview.original')),
                      h('pre', { className: 'tacit-pre' }, preview.original)),
                    h('div', { className: 'tacit-modal-col' },
                      h('div', { className: 'tacit-modal-col-title' }, t('preview.improved')),
                      h('pre', { className: 'tacit-pre' }, preview.data !== null && typeof preview.data.improved === 'string' ? preview.data.improved : ''))),
                  preview.data !== null && typeof preview.data === 'object' && typeof preview.data.rationale === 'string' && preview.data.rationale.length > 0
                    ? h('div', { className: 'tacit-modal-rationale' },
                      h('div', { className: 'tacit-modal-col-title' }, t('preview.rationale')),
                      h('div', { className: 'tacit-modal-rationale-text' }, preview.data.rationale))
                    : null,
                  h('div', { className: 'tacit-modal-actions' },
                    h('button', { type: 'button', className: 'tacit-btn tacit-btn-primary', onClick: onApply }, t('preview.apply')),
                    h('button', { type: 'button', className: 'tacit-btn', onClick: onCancel }, t('preview.cancel'))))))
      }
    }

    // ── Feedback strip (under the composer, Improve enabled only) ───────────

    function FeedbackStrip(kit) {
      const { t } = kit
      return function FeedbackStripView(props) {
        const store = storeFor(props.sessionId)
        useStoreVersion(store)
        useEffect(() => {
          if (store !== null) initStore(store)
        }, [store])
        // The input machine's phase: 'submitting' means the user sent — the
        // strip fades out right after the next send.
        const phase = typeof props.useInput === 'function'
          ? props.useInput((state) => (state === null || typeof state !== 'object' ? '' : state.phase))
          : ''
        useEffect(() => {
          if (phase === 'submitting' && store !== null && store.feedback.open && !store.feedback.sending) {
            fadeFeedback(store)
          }
        }, [phase, store])

        if (store === null || !store.feedback.open) return null
        const feedback = store.feedback
        const reason = feedback.reason

        return h('div', {
          className: 'tacit-feedback' + (feedback.fading ? ' tacit-feedback-fading' : ''),
          'data-testid': 'tacit-feedback',
        },
        feedback.noted
          ? h('span', { className: 'tacit-feedback-noted' }, t('feedback.noted'))
          : h('div', { className: 'tacit-feedback-row' },
            h('span', { className: 'tacit-feedback-title' }, t('feedback.title')),
            h('button', {
              type: 'button',
              className: 'tacit-feedback-vote',
              title: t('feedback.up'),
              'aria-label': t('feedback.up'),
              onClick: () => voteFeedback(store, 'up'),
            }, '👍'),
            h('button', {
              type: 'button',
              className: 'tacit-feedback-vote' + (feedback.verdict === 'down' ? ' tacit-feedback-vote-active' : ''),
              title: t('feedback.down'),
              'aria-label': t('feedback.down'),
              onClick: () => voteFeedback(store, 'down'),
            }, '👎'),
            feedback.verdict === 'down'
              ? h('div', { className: 'tacit-feedback-reason' },
                h('input', {
                  className: 'tacit-input tacit-feedback-input',
                  type: 'text',
                  maxLength: 300,
                  placeholder: t('feedback.reasonPlaceholder'),
                  value: reason,
                  onChange: (event) => {
                    store.feedback = { ...store.feedback, reason: event.target.value }
                    notify(store)
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'tacit-btn tacit-btn-sm',
                  disabled: feedback.sending || reason.trim().length === 0,
                  onClick: () => sendFeedback(store, 'down'),
                }, feedback.sending ? '…' : t('feedback.send')))
              : null))
      }
    }

    // ── Global panel (settings section, sidebar action, frame overlay) ─────

    function DirectivesEditor(kit) {
      const { t } = kit
      return function DirectivesEditorView(props) {
        const { config, directives, steering } = props
        const [draft, setDraft] = useState('')
        const [steerOn, setSteerOn] = useState(config !== null && config.steerAgent !== false)
        const [enrichOn, setEnrichOn] = useState(config !== null && config.enrichPrompts === true)
        useEffect(() => {
          if (config !== null && typeof config.steerAgent === 'boolean') setSteerOn(config.steerAgent)
          if (config !== null && typeof config.enrichPrompts === 'boolean') setEnrichOn(config.enrichPrompts)
        }, [config])
        const toggleSteer = () => {
          const next = !steerOn
          setSteerOn(next)
          updateRootConfig({ steerAgent: next })
        }
        const toggleEnrich = () => {
          const next = !enrichOn
          setEnrichOn(next)
          updateRootConfig({ enrichPrompts: next })
        }
        const onAdd = () => {
          const text = draft.trim()
          if (text.length === 0) return
          setDraft('')
          editDirectives({ action: 'add', text: text.slice(0, 300) })
        }
        return h('div', { className: 'tacit-panel-section', 'data-testid': 'tacit-steering' },
          h('div', { className: 'tacit-report-title' }, t('steer.title')),
          h('div', { className: 'tacit-panel-hint' }, t('steer.desc')),
          h('div', { className: 'tacit-settings-row' },
            h('label', { className: 'tacit-settings-label' }, t('steer.toggle')),
            h('input', { type: 'checkbox', checked: steerOn, onChange: toggleSteer })),
          h('div', { className: 'tacit-settings-row' },
            h('label', { className: 'tacit-settings-label' }, t('steer.enrich')),
            h('input', { type: 'checkbox', checked: enrichOn, onChange: toggleEnrich })),
          directives.length === 0
            ? h('div', { className: 'tacit-empty' }, t('steer.empty'))
            : h('div', { className: 'tacit-rules-list' },
              directives.map((entry) => h('div', { key: entry.id, className: 'tacit-rule tacit-directive' + (entry.enabled === false ? ' tacit-directive-off' : '') },
                h('input', {
                  type: 'checkbox',
                  className: 'tacit-check',
                  'data-testid': 'tacit-directive-toggle',
                  checked: entry.enabled !== false,
                  onChange: () => editDirectives({ action: 'toggle', id: entry.id, enabled: entry.enabled === false }),
                }),
                h('span', { className: 'tacit-directive-text' }, String(entry.text)),
                h('span', { className: 'tacit-chip' }, entry.source === 'user' ? t('steer.user') : t('steer.distilled')),
                entry.status === 'candidate'
                  ? h('span', { className: 'tacit-chip tacit-chip-trial' }, t('steer.trial', {
                    n: String(entry.trial !== null && typeof entry.trial === 'object' && typeof entry.trial.turns === 'number' ? entry.trial.turns : 0),
                    total: String(config !== null && typeof config.directiveTrialTurns === 'number' ? config.directiveTrialTurns : 10),
                  }))
                  : entry.status === 'retired'
                    ? h('span', { className: 'tacit-chip tacit-chip-warn' }, t('steer.retired', { reason: String(entry.retiredReason || '') }))
                    : h('span', { className: 'tacit-chip tacit-chip-ok' }, t('steer.active')),
                h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => editDirectives({ action: 'remove', id: entry.id }) }, t('steer.remove'))))),
          h('div', { className: 'tacit-settings-row' },
            h('input', {
              className: 'tacit-input tacit-directive-input',
              type: 'text',
              maxLength: 300,
              placeholder: t('steer.addPlaceholder'),
              'aria-label': t('steer.add'),
              value: draft,
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') onAdd()
              },
            }),
            h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', disabled: draft.trim().length === 0, onClick: onAdd }, t('steer.add'))),
          steering !== null && typeof steering === 'object' && typeof steering.text === 'string' && steering.text.length > 0
            ? h('details', { className: 'tacit-preview' },
              h('summary', null, t('steer.preview')),
              h('pre', { className: 'tacit-pre' }, steering.text))
            : null)
      }
    }

    function CoachPanel(kit) {
      const { t, fmtTime } = kit
      const DirectivesEditorView = DirectivesEditor(kit)
      return function CoachPanelView() {
        useRootVersion()
        useEffect(() => {
          initRootStore()
        }, [])

        const config = configOf(rootStore.config)
        const profile = profileOf(rootStore.profile)
        const [model, setModel] = useState(config !== null && typeof config.model === 'string' ? config.model : 'deepseek-v4-flash')
        const [budgetText, setBudgetText] = useState(config !== null && typeof config.autoDailyBudget === 'number' ? String(config.autoDailyBudget) : '30')
        const [auto, setAuto] = useState(config !== null && config.autoAnalyze !== false)
        const [live, setLive] = useState(config !== null && config.liveSuggestions !== false)

        useEffect(() => {
          if (config !== null) {
            if (typeof config.model === 'string') setModel(config.model)
            if (typeof config.autoDailyBudget === 'number') setBudgetText(String(config.autoDailyBudget))
            if (typeof config.autoAnalyze === 'boolean') setAuto(config.autoAnalyze)
            if (typeof config.liveSuggestions === 'boolean') setLive(config.liveSuggestions)
          }
        }, [config])

        const applyModel = (value) => {
          setModel(value)
          updateRootConfig({ model: value })
        }
        const applyBudget = () => {
          const number = Math.max(0, Math.min(1000, Math.round(Number(budgetText) || 0)))
          setBudgetText(String(number))
          updateRootConfig({ autoDailyBudget: number })
        }
        const toggleAuto = () => {
          const next = !auto
          setAuto(next)
          updateRootConfig({ autoAnalyze: next })
        }
        const toggleLive = () => {
          const next = !live
          setLive(next)
          updateRootConfig({ liveSuggestions: next })
        }

        const coached = Array.isArray(rootStore.coached) ? rootStore.coached : []
        const error = rootStore.error
        const styleRules = rootStore.profile !== null && typeof rootStore.profile === 'object' && Array.isArray(rootStore.profile.styleRules)
          ? rootStore.profile.styleRules.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.rule === 'string' && entry.rule.length > 0)
          : []
        const directives = rootStore.profile !== null && typeof rootStore.profile === 'object' && Array.isArray(rootStore.profile.directives)
          ? rootStore.profile.directives.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.text === 'string')
          : []

        return h('div', { className: 'tacit-panel' },
          StatusCard(kit, { config, profile, auto: rootStore.auto, trend: rootStore.trend }),
          h('div', { className: 'tacit-settings-row' },
            BootstrapButton(kit, { bootstrap: rootStore.bootstrap, onClick: () => bootstrapAll() }),
            h('span', { className: 'tacit-panel-hint' }, t('bootstrap.hint'))),
          h('div', { className: 'tacit-settings' },
            h('div', { className: 'tacit-settings-title' }, t('settings.title')),
            h('div', { className: 'tacit-settings-row' },
              h('label', { className: 'tacit-settings-label' }, t('settings.model')),
              h('select', {
                className: 'tacit-select',
                value: model,
                onChange: (event) => applyModel(event.target.value),
              },
              h('option', { value: 'deepseek-v4-flash' }, 'deepseek-v4-flash'),
              h('option', { value: 'deepseek-v4-pro' }, 'deepseek-v4-pro'))),
            h('div', { className: 'tacit-settings-row' },
              h('label', { className: 'tacit-settings-label' }, t('settings.auto')),
              h('input', { type: 'checkbox', checked: auto, onChange: toggleAuto })),
            h('div', { className: 'tacit-settings-row' },
              h('label', { className: 'tacit-settings-label' }, t('settings.budget')),
              h('input', {
                className: 'tacit-input',
                type: 'number',
                min: 0,
                value: budgetText,
                onChange: (event) => setBudgetText(event.target.value),
              }),
              h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: applyBudget }, t('settings.apply'))),
            h('div', { className: 'tacit-settings-row' },
              h('label', { className: 'tacit-settings-label' }, t('settings.live')),
              h('input', { type: 'checkbox', checked: live, onChange: toggleLive })),
            h('div', { className: 'tacit-settings-row' },
              h('button', { type: 'button', className: 'tacit-btn tacit-btn-sm', onClick: () => clearAllRoot() }, t('settings.clear')))),
          error !== null && typeof error === 'object'
            ? h('div', { className: 'tacit-error' }, t('err.' + String(error.code), { detail: String(error.detail || '') }))
            : null,
          h(DirectivesEditorView, { config, directives, steering: rootStore.steering }),
          h('div', { className: 'tacit-panel-section' },
            h('div', { className: 'tacit-report-title' }, t('panel.styleRules')),
            styleRules.length === 0
              ? h('div', { className: 'tacit-empty' }, t('panel.styleRulesEmpty'))
              : h('div', { className: 'tacit-rules-list' },
                styleRules.map((entry, index) => h('div', { key: 'rule-' + index, className: 'tacit-rule' }, String(entry.rule))))),
          h('div', { className: 'tacit-panel-section' },
            h('div', { className: 'tacit-report-title' }, t('panel.coached')),
            coached.length === 0
              ? h('div', { className: 'tacit-empty' }, t('panel.coachedEmpty'))
              : h('div', { className: 'tacit-coached-list' },
                coached.map((entry, index) => h('div', { key: 'c' + index, className: 'tacit-coached-row' },
                  h('div', { className: 'tacit-coached-meta' },
                    h('span', { className: 'tacit-coached-turn' }, (typeof entry.sessionLabel === 'string' && entry.sessionLabel.length > 0 ? entry.sessionLabel + ' · ' : '') + '# ' + String(entry.turn)),
                    h('span', { className: 'tacit-coached-time' }, fmtTime(entry.time)),
                    h('span', { className: 'tacit-chip tacit-coached-trigger' }, t('trigger.' + (entry.trigger === 'auto' || entry.trigger === 'correction' || entry.trigger === 'bootstrap' ? entry.trigger : 'manual')))),
                  typeof entry.promptExcerpt === 'string' && entry.promptExcerpt.length > 0
                    ? h('div', { className: 'tacit-coached-excerpt' }, entry.promptExcerpt)
                    : null,
                  typeof entry.improvedPrompt === 'string' && entry.improvedPrompt.length > 0
                    ? h('div', { className: 'tacit-coached-improved' }, entry.improvedPrompt.slice(0, 240) + (entry.improvedPrompt.length > 240 ? '…' : ''))
                    : null)))),
          h('div', { className: 'tacit-panel-hint' }, t('panel.hint')))
      }
    }

    function SettingsSection(kit) {
      const { t } = kit
      const CoachPanelView = CoachPanel(kit)
      return function SettingsSectionView() {
        useEffect(() => {
          initRootStore()
          // Fresh read so freshly distilled style rules appear on open.
          refreshRootState()
        }, [])
        return h('div', { className: 'tacit-root' },
          h('div', { className: 'tacit-head' }, h('div', { className: 'tacit-head-title' }, t('panel.title'))),
          h(CoachPanelView))
      }
    }

    // ── CSS (injected once) ────────────────────────────────────────────────

    const css = '.tacit-root{box-sizing:border-box;height:100%;color:var(--dsw-alias-label-primary);padding:16px 20px 32px;font-size:13px;overflow-y:auto}'
      + '.tacit-head{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}.tacit-head-title{font-size:14px;font-weight:600;margin-right:auto}'
      + '.tacit-progress{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 12px;margin-bottom:12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.tacit-progress-title{font-weight:600;color:var(--dsw-alias-label-primary)}'
      + '.tacit-empty{color:var(--dsw-alias-label-secondary);text-align:center;padding:24px 8px;line-height:1.6}'
      + '.tacit-error{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 12px;margin-bottom:12px;overflow-wrap:anywhere;font-size:12px}'
      + '.tacit-btn{font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;cursor:pointer;padding:4px 10px}.tacit-btn:hover{border-color:var(--dsw-alias-label-primary)}.tacit-btn:disabled{opacity:.55;cursor:default}'
      + '.tacit-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}.tacit-btn-primary:hover{border-color:transparent;filter:brightness(1.1)}'
      + '.tacit-btn-sm{padding:2px 8px;font-size:11px}'
      + '.tacit-row{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;margin-bottom:10px}'
      + '.tacit-row-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px}.tacit-row-heading{display:flex;align-items:baseline;gap:8px;font-weight:600}.tacit-row-turn{font-size:13px}.tacit-row-time{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400}.tacit-row-live{color:var(--dsw-alias-state-success-primary);font-size:11px;font-weight:600}'
      + '.tacit-row-chips{display:flex;flex-wrap:wrap;gap:4px;margin-left:auto}.tacit-chip{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);border-radius:4px;padding:1px 7px;font-size:11px}.tacit-chip-warn{color:var(--dsw-alias-state-warn-primary)}'
      + '.tacit-row-prompt{display:flex;align-items:flex-start;gap:8px;margin-top:8px}.tacit-row-prompt-text{font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:none;border:0;cursor:pointer;text-align:left;padding:0;white-space:pre-wrap;word-break:break-word;flex:1;line-height:1.55}'
      + '.tacit-report{border-top:1px dashed var(--dsw-alias-border-l1);margin-top:10px;padding-top:10px;display:flex;flex-direction:column;gap:6px}'
      + '.tacit-report-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary)}'
      + '.tacit-report-note{color:var(--dsw-alias-label-secondary);font-size:12px}'
      + '.tacit-report-body{color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.6;word-break:break-word}.tacit-report-body>div{font-size:13px;line-height:1.6}'
      + '.tacit-report-improved{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:8px 10px;display:flex;flex-direction:column;gap:6px}'
      + '.tacit-report-actions{display:flex;justify-content:flex-end}'
      + '.tacit-problem{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-state-warn-primary);border-radius:6px;background:var(--dsw-alias-bg-layer-2);padding:6px 10px;display:flex;flex-direction:column;gap:3px}'
      + '.tacit-problem-head{display:flex;align-items:center;gap:8px}.tacit-problem-kind{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:600}.tacit-problem-sev{font-size:10px;font-weight:600;border-radius:4px;padding:1px 6px}'
      + '.tacit-sev-high{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent);color:var(--dsw-alias-state-error-primary)}'
      + '.tacit-sev-medium{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, transparent);color:var(--dsw-alias-state-warn-primary)}'
      + '.tacit-sev-low{background:color-mix(in srgb, var(--dsw-alias-label-secondary) 18%, transparent);color:var(--dsw-alias-label-secondary)}'
      + '.tacit-sev-info{background:color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent);color:var(--dsw-alias-brand-primary)}'
      + '.tacit-problem-what{font-size:12px;color:var(--dsw-alias-label-primary);line-height:1.5}.tacit-problem-why{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}'
      + '.tacit-pre{margin:0;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary)}'
      + '.tacit-settings{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;flex-direction:column;gap:8px}'
      + '.tacit-settings-title{font-size:12px;font-weight:600}.tacit-settings-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tacit-settings-label{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:150px}'
      + '.tacit-settings-notice{font-size:11px;color:var(--dsw-alias-state-success-primary)}'
      + '.tacit-select,.tacit-input{font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:3px 8px}.tacit-input{width:90px}'
      + '.tacit-improve-btn{font:inherit;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-secondary);background:transparent;border:0;border-radius:24px;cursor:pointer;height:28px;padding:0 8px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px}.tacit-improve-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}'
      + '.tacit-check{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);flex:none;margin:2px 4px 0 0}'
      + '.tacit-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}.tacit-toolbar-hint{flex:1;min-width:200px}.tacit-btn-quiet{color:var(--dsw-alias-label-secondary);background:transparent}.tacit-chip-muted{opacity:.7}.tacit-row-analyzed{border-left:3px solid var(--dsw-alias-brand-primary)}'
      + '.tacit-progress-head{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}.tacit-progress-count{font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-primary)}'
      + '.tacit-progress-text{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}'
      + '.tacit-panel{display:flex;flex-direction:column;gap:10px}.tacit-panel-section{display:flex;flex-direction:column;gap:6px}.tacit-panel-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}'
      + '.tacit-coached-list{display:flex;flex-direction:column;gap:6px}.tacit-coached-row{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;display:flex;flex-direction:column;gap:3px}'
      + '.tacit-coached-meta{display:flex;align-items:baseline;gap:8px}.tacit-coached-turn{font-weight:600;font-size:12px}.tacit-coached-time{color:var(--dsw-alias-label-secondary);font-size:11px}'
      + '.tacit-coached-excerpt{font-size:12px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;line-height:1.5}.tacit-coached-improved{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;white-space:pre-wrap;word-break:break-word}'
      + ''
      + '.tacit-modal-backdrop{z-index:200;background:#00000073;display:flex;justify-content:center;align-items:center;position:fixed;inset:0}'
      + '.tacit-modal-card{box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);width:min(760px,100vw - 48px);max-height:min(84vh,800px);box-shadow:var(--dsw-shadow-lv3,0 12px 32px #0006);color:var(--dsw-alias-label-primary);border-radius:12px;padding:16px 18px 18px;font-size:13px;display:flex;flex-direction:column;gap:10px;overflow-y:auto}'
      + '.tacit-modal-head{display:flex;align-items:baseline;gap:8px}.tacit-modal-title{font-size:14px;font-weight:600;margin-right:auto}.tacit-modal-close{color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:0;border-radius:6px;padding:2px 8px;font-family:inherit;font-size:18px;line-height:1}.tacit-modal-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}'
      + '.tacit-modal-pending{color:var(--dsw-alias-label-secondary);padding:16px 0;text-align:center}'
      + '.tacit-modal-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}.tacit-modal-col{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);padding:8px 10px;min-width:0;max-height:300px;overflow-y:auto}'
      + '.tacit-modal-col-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:6px}'
      + '.tacit-modal-rationale-text{font-size:12px;color:var(--dsw-alias-label-primary);line-height:1.6}.tacit-modal-savings{color:var(--dsw-alias-state-success-primary);font-size:12px;font-weight:600}'
      + '.tacit-modal-actions{display:flex;gap:8px;justify-content:flex-end}'
      + '.tacit-feedback{display:flex;justify-content:center;align-items:center;margin:8px 2px 0;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;gap:8px;transition:opacity .35s ease}.tacit-feedback-fading{opacity:0}'
      + '.tacit-feedback-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.tacit-feedback-title{color:var(--dsw-alias-label-secondary)}'
      + '.tacit-feedback-vote{font:inherit;font-size:14px;line-height:1;cursor:pointer;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:3px 8px}.tacit-feedback-vote:hover{border-color:var(--dsw-alias-brand-primary)}.tacit-feedback-vote-active{border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent)}'
      + '.tacit-feedback-reason{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.tacit-feedback-input{width:260px;max-width:60vw}'
      + '.tacit-feedback-noted{color:var(--dsw-alias-state-success-primary);font-weight:600}'
      + '.tacit-trend{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px}.tacit-chip-trigger,.tacit-coached-trigger{text-transform:uppercase;letter-spacing:.04em;font-size:10px}.tacit-coached-trigger{margin-left:auto}.tacit-row-enrichment{margin-top:8px;border-left:3px solid var(--dsw-alias-brand-primary);padding:4px 10px;background:var(--dsw-alias-bg-layer-2);border-radius:6px}'
      + '.tacit-chip-trial{color:var(--dsw-alias-brand-primary)}.tacit-chip-ok{color:var(--dsw-alias-state-success-primary)}'
      + '.tacit-directive{display:flex;align-items:center;gap:8px}.tacit-directive-text{flex:1;min-width:0}.tacit-directive-off .tacit-directive-text{opacity:.5;text-decoration:line-through}.tacit-directive-input{width:min(420px,100%);flex:1}.tacit-preview summary{cursor:pointer;font-size:11px;color:var(--dsw-alias-label-secondary)}.tacit-preview pre{margin-top:6px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:8px 10px}'
      + '.tacit-rules-list{display:flex;flex-direction:column;gap:6px}.tacit-rule{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-brand-primary);border-radius:6px;padding:6px 10px;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}'

    function injectCss() {
      const tagId = 'dsh-tacit/styles.css'
      if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = NS
        tag.dataset.pluginCss = tagId
        tag.textContent = css
        document.head.appendChild(tag)
      }
    }

    // ── Client plugin body ──────────────────────────────────────────────────

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'dsh-tacit: dictionaries')
      const t = ctx.locale.bind(NS)
      const kit = makeKit(t)
      injectCss()

      const CoachTabView = CoachTab(kit)
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'tacit',
        order: 30,
        locale: NS,
        label: () => t('tab'),
      }, (props) => h(CoachTabView, props)))

      const ImproveButtonView = ImproveButton(kit)
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'tacit-improve',
        order: 100,
        locale: NS,
        label: () => t('improve.btn'),
      }, (props) => h(ImproveButtonView, props)))

      const PreviewOverlayView = PreviewOverlay(kit)
      ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
        name: 'conversation.input.overlay',
        id: 'tacit-preview',
        order: 10,
        locale: NS,
        inject: (sessionId) => ({ tacitStore: storeFor(sessionId) }),
      }, (props) => h(PreviewOverlayView, props)))

      // The post-apply 👍/👎 strip lives in the band UNDER the composer card
      // (composer.dock), only while the Improve button is enabled.
      const FeedbackStripView = FeedbackStrip(kit)
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'tacit-feedback',
        order: 10,
        locale: NS,
        label: () => t('feedback.title'),
      }, (props) => h(FeedbackStripView, props)))

      // Own Settings page under "Cost": a nav section in the Settings panel,
      // on its own. Reuses the coach panel. Order 32 places it right after
      // cost-meter's "Cost" section (order 30/31).
      const SettingsSectionView = SettingsSection(kit)
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'tacit',
        order: 32,
        locale: NS,
        label: () => t('settings.sectionLabel'),
      }, (props) => h(SettingsSectionView, props)))
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply,
      // Test-only handles for the SSR suite (ignored by the module loader).
      __test: {
        css,
        applyImproved,
        closePreview,
        closeFeedback,
        fadeFeedback,
        rootStore,
      },
    }
  },
})
