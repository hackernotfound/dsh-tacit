/**
 * dsh-tacit — analysis: prompt building, model call, parsing, profile
 * aggregation. Pure functions are exported for unit tests; the only harness
 * coupling is the `ctx.llm.stream` waterfall (credentials resolved by the
 * harness itself — this plugin never reads or stores API keys).
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { z } from 'zod'
import { reportSchema, profileSchema } from './schema.js'

export const ANALYZE_TIMEOUT_MS = 120000
export const IMPROVE_TIMEOUT_MS = 60000
export const DISTILL_TIMEOUT_MS = 30000
export const ANALYZE_MAX_TOKENS = 3000
export const IMPROVE_MAX_TOKENS = 1500
/**
 * Output budgets include the model's (low-effort) reasoning tokens — a budget
 * that is too small ends the call before the tool call is emitted, which
 * surfaces as an empty answer. Only generated tokens are billed.
 */
export const DISTILL_MAX_TOKENS = 1000
export const DISTILL_MAX_RULES = 3
export const MAX_STYLE_RULES = 6
export const MAX_GOOD_EXAMPLES = 10
export const MAX_FEEDBACK_LOG = 10
export const MAX_FEEDBACK_REASON_CHARS = 300
/** A rewrite record needs at least this many applied samples before its trust gates it. */
export const TRUST_MIN_APPLIED = 2
/** Reasoning effort for every coach call (DeepSeek accepts off|low|high|max). */
export const COACH_REASONING_EFFORT = 'low'

/** Clip to `max` UTF-16 units without splitting a surrogate pair. */
export function clipSafe(value, max) {
  const text = typeof value === 'string' ? value : ''
  if (text.length <= max) return text
  let end = max
  if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1
  return text.slice(0, end)
}

// ── Structured output: the model answers by CALLING one tool whose arguments
// are the payload (the harness has no JSON mode; tool arguments are the
// reliable structured channel). Text JSON is still accepted as a fallback.

const PROBLEM_PARAMETERS = {
  type: 'object',
  properties: {
    kind: { type: 'string', description: 'short category, e.g. missing-constraints|ambiguous-goal|missing-context|wrong-scope' },
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    what: { type: 'string', description: 'one sentence: what the prompt got wrong' },
    why: { type: 'string', description: 'one sentence: the observed trajectory evidence' },
  },
  required: ['kind', 'severity', 'what', 'why'],
}

export const ANALYSIS_TOOL = {
  name: 'report',
  description: 'Submit the coaching report for the analyzed prompt.',
  parameters: {
    type: 'object',
    properties: {
      problems: { type: 'array', items: PROBLEM_PARAMETERS },
      improvedPrompt: { type: 'string', description: 'rewritten prompt that keeps the intent but fixes the problems' },
      explanation: { type: 'string', description: '2-4 sentences summarizing the key improvements' },
      estimatedTokenSavingPct: { type: 'integer', minimum: 0, maximum: 90 },
    },
    required: ['problems', 'improvedPrompt', 'explanation', 'estimatedTokenSavingPct'],
  },
}

export const IMPROVE_TOOL = {
  name: 'improved',
  description: 'Submit the rewritten draft.',
  parameters: {
    type: 'object',
    properties: {
      improved: { type: 'string', description: 'the rewritten prompt' },
      rationale: { type: 'string', description: '1-2 sentences on what changed and why' },
      savingsEstimate: { type: 'integer', minimum: 0, maximum: 90 },
    },
    required: ['improved', 'rationale', 'savingsEstimate'],
  },
}

export const DIRECTIVE_TOOL = {
  name: 'directives',
  description: 'Submit the agent-facing directives distilled from this user\'s prompting habits.',
  parameters: {
    type: 'object',
    properties: {
      directives: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
    },
    required: ['directives'],
  },
}
export const DIRECTIVE_MAX_TOKENS = 1500
export const DIRECTIVE_TIMEOUT_MS = 30000
export const MAX_DIRECTIVES = 8
export const DIRECTIVE_MAX_CHARS = 220
/** Whole steering section budget (~300 tokens). */
export const STEERING_MAX_CHARS = 1400

// ── Opt-in pre-send enrichment ─────────────────────────────────────────────

export const ENRICH_MAX_TOKENS = 1000
export const ENRICH_TIMEOUT_MS = 15000
export const ENRICH_MIN_DRAFT_CHARS = 8
export const ENRICH_MAX_DRAFT_CHARS = 1500
export const ENRICH_PREFIX = 'Context from Tacit (learned from this user\'s past prompts, not their words): '

export const ENRICH_TOOL = {
  name: 'context',
  description: 'Submit the context note to append for the agent, or an empty note when the prompt is already clear.',
  parameters: {
    type: 'object',
    properties: {
      note: { type: 'string', description: '1-3 short sentences: what the user probably means and what to check before starting; empty when nothing is worth adding' },
    },
    required: ['note'],
  },
}

export const ENRICH_SYSTEM_PROMPT = [
  'You help a coding agent understand ONE specific user. You are given what',
  'the coach learned about how this user under-specifies prompts, the recent',
  'conversation, and the prompt the user is sending right now.',
  'Write a SHORT context note (1-3 sentences) for the agent: the most likely',
  'intent behind the prompt and 1-2 concrete things to check or assume before',
  'starting, based on this user\'s habits. Never add requirements the user did',
  'not imply, never restate the prompt, never give generic advice. If the',
  'prompt is already specific enough, return an empty note.',
].join('\n')

export function buildEnrichUserText({ draft, profile, recentContext }) {
  const lines = []
  const directives = (Array.isArray(profile?.directives) ? profile.directives : [])
    .filter((entry) => entry !== null && typeof entry === 'object' && entry.enabled !== false && typeof entry.text === 'string')
  if (directives.length > 0) {
    lines.push('=== WHAT THE COACH KNOWS ABOUT THIS USER ===')
    for (const entry of directives.slice(0, MAX_DIRECTIVES)) lines.push('- ' + clipSafe(entry.text, DIRECTIVE_MAX_CHARS))
    lines.push('')
  }
  const patterns = Array.isArray(profile?.patterns) ? profile.patterns.slice(0, 6) : []
  if (patterns.length > 0) {
    lines.push('=== RECURRING HABITS ===')
    for (const pattern of patterns) lines.push('- ' + String(pattern.kind) + ': ' + clipSafe(String(pattern.lastExample ?? ''), 160))
    lines.push('')
  }
  if (typeof recentContext === 'string' && recentContext.length > 0) {
    lines.push('=== RECENT CONVERSATION ===', clipSafe(recentContext, 1200), '')
  }
  lines.push('=== THE PROMPT BEING SENT NOW ===', clipSafe(String(draft ?? ''), ENRICH_MAX_DRAFT_CHARS))
  return lines.join('\n')
}

/** The note text, trimmed and clipped; '' when the model had nothing to add. */
export function normalizeEnrichNote(text) {
  const parsed = parseJsonObject(text)
  const note = parsed !== null && typeof parsed.note === 'string' ? parsed.note.trim() : ''
  return clipSafe(note, 600)
}

// ── Measured trend ─────────────────────────────────────────────────────────

function windowStats(turns) {
  const n = turns.length
  if (n === 0) return { n: 0, messyRate: 0, tokensPerTurn: 0 }
  let messy = 0
  let tokens = 0
  for (const turn of turns) {
    if (isMessyTurn(turn, { minSteps: Number.POSITIVE_INFINITY })) messy += 1
    const usage = turn.usage !== null && typeof turn.usage === 'object' ? turn.usage : {}
    const read = (key) => (typeof usage[key] === 'number' && Number.isFinite(usage[key]) ? usage[key] : 0)
    tokens += read('inputTokens') + read('outputTokens') + read('cacheReadTokens') + read('reasoningTokens')
  }
  return { n, messyRate: messy / n, tokensPerTurn: Math.round(tokens / n) }
}

/**
 * Real before/after numbers from the fold: the first `window` finished turns
 * vs. the latest `window`, on rework signals (retries/errors/compactions/
 * rejections — step counts are deliberately NOT a signal) and tokens/turn.
 */
export function computeTrend(turns, { window = 20 } = {}) {
  const finished = (Array.isArray(turns) ? turns : [])
    .filter((turn) => turn !== null && typeof turn === 'object' && turn.finished === true)
    .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
  const size = Math.max(1, Math.round(window))
  const early = finished.slice(0, size)
  const recent = finished.slice(-size)
  return {
    enough: finished.length >= size * 2,
    window: size,
    early: windowStats(early),
    recent: windowStats(recent),
  }
}

export const DISTILL_TOOL = {
  name: 'rules',
  description: 'Submit the distilled style rules.',
  parameters: {
    type: 'object',
    properties: {
      rules: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    },
    required: ['rules'],
  },
}

const analysisReportShape = z.object({
  problems: z.array(
    z.object({
      kind: z.string(),
      severity: z.string(),
      what: z.string(),
      why: z.string(),
    }),
  ).default([]),
  improvedPrompt: z.string().default(''),
  explanation: z.string().default(''),
  estimatedTokenSavingPct: z.number().default(0),
})

const improveShape = z.object({
  improved: z.string().default(''),
  rationale: z.string().default(''),
  savingsEstimate: z.number().default(0),
})

export const ANALYSIS_SYSTEM_PROMPT = [
  'You are a strict but friendly prompt-engineering coach inside DeepSeek Harness.',
  'You are given ONE past user prompt plus a digest of everything that happened',
  'while the agent answered it: tool calls made, steps taken, retries,',
  'compactions, token usage, and the final response (excerpt).',
  '',
  'Your job: diagnose the PROMPT, not the agent. Point out what the prompt left',
  'ambiguous or under-specified and how that caused the observed trajectory',
  '(wrong tools, extra steps, retries, wasted tokens, off-target answer).',
  'Prioritize concrete, actionable findings grounded in the digest. When the',
  "user's NEXT message is included, it is the strongest evidence: it shows",
  'what the prompt failed to say and what the user actually wanted.',
  '',
  'The conversation carries across turns. A short prompt ("continue", "go',
  'ahead", "yes") is ADEQUATE when the previous turn supplies the context —',
  'never blame it for being short. Heavy but successful work (many steps or',
  'tool calls) is NOT a prompt fault; only rework signals are: retries, tool',
  'errors, compactions, cancellation, or the user correcting the agent next.',
  'When the prompt was adequate, return "problems": [] and the original prompt',
  'unchanged as improvedPrompt.',
  '',
  'RESPONSE FORMAT — this is mandatory and machine-parsed:',
  'Your ENTIRE response must be ONE JSON object and nothing else. No preamble,',
  'no narration, no explanations outside the JSON, no markdown fences.',
  'Start directly with "{" and end with "}".',
  '{',
  '  "problems": [',
  '    {"kind": "<short category, e.g. missing-constraints|ambiguous-goal|missing-context|wrong-scope>",',
  '     "severity": "high|medium|low",',
  '     "what": "<one sentence: what the prompt got wrong>",',
  '     "why": "<one sentence: the observed trajectory evidence>"}',
  '  ],',
  '  "improvedPrompt": "<a rewritten version of the original prompt that keeps its intent but fixes the problems>",',
  '  "explanation": "<2-4 sentences summarizing the key improvements>",',
  '  "estimatedTokenSavingPct": <integer 0-90, rough expected reduction in total tokens for this task>',
  '}',
  '',
  'Reply in the same language as the prompt being analyzed.',
].join('\n')

export const IMPROVE_SYSTEM_PROMPT = [
  'You are a prompt-improvement assistant inside DeepSeek Harness.',
  'The user typed a draft prompt into the composer. Rewrite it to be more',
  'precise, complete, and token-efficient, while PRESERVING its intent.',
  'Do not add requirements the user did not ask for; fill in only what is',
  'genuinely underspecified (scope, constraints, format, acceptance criteria).',
  'Learn from the user\'s recurring mistake patterns when provided.',
  '',
  'RESPONSE FORMAT — this is mandatory and machine-parsed:',
  'Your ENTIRE response must be ONE JSON object and nothing else. No preamble,',
  'no narration, no explanations outside the JSON, no markdown fences.',
  'Start directly with "{" and end with "}".',
  '{',
  '  "improved": "<the rewritten prompt>",',
  '  "rationale": "<1-2 sentences on what you changed and why>",',
  '  "savingsEstimate": <integer 0-90, rough expected reduction in tokens for this task>',
  '}',
  '',
  'Reply in the same language as the draft.',
].join('\n')

/**
 * One-shot repair prompts: used when the first answer was not parseable JSON.
 * The model re-generates the SAME payload, this time under a hard
 * JSON-only instruction (its previous prose is not fed back — the original
 * task is enough).
 */
export const ANALYSIS_REPAIR_SYSTEM_PROMPT = [
  'You are a strict prompt-engineering coach inside DeepSeek Harness.',
  'Your previous response was not a valid JSON object.',
  'Now respond with EXACTLY ONE JSON object and nothing else — no prose,',
  'no narration, no markdown fences. Start directly with "{" and end with "}".',
  'Use the shape:',
  '{"problems":[{"kind":"<short category>","severity":"high|medium|low","what":"<one sentence>","why":"<one sentence, trajectory evidence>"}],',
  '"improvedPrompt":"<rewritten prompt keeping the intent>",',
  '"explanation":"<2-4 sentences>",',
  '"estimatedTokenSavingPct":<integer 0-90>}',
  'Reply in the same language as the prompt being analyzed.',
].join('\n')

export const IMPROVE_REPAIR_SYSTEM_PROMPT = [
  'You are a prompt-improvement assistant inside DeepSeek Harness.',
  'Your previous response was not a valid JSON object.',
  'Now respond with EXACTLY ONE JSON object and nothing else — no prose,',
  'no narration, no markdown fences. Start directly with "{" and end with "}".',
  'Use the shape:',
  '{"improved":"<the rewritten prompt>","rationale":"<1-2 sentences>","savingsEstimate":<integer 0-90>}',
  'Reply in the same language as the draft.',
].join('\n')

/**
 * Style-rule distillation: the ONLY new paid model call of the v2 loop,
 * fired rarely (every 3+ unreviewed 👎 reasons) with a hard 300-token cap.
 */
export const DISTILL_SYSTEM_PROMPT = [
  'You distill user feedback into durable prompt-writing style rules for a',
  'prompt-improvement coach inside DeepSeek Harness.',
  'Given verbatim reasons why the user rejected past prompt rewrites, write',
  '2-3 general, durable style rules the coach must follow in EVERY future',
  'rewrite. Each rule is one complete imperative sentence, specific enough',
  'to steer a rewrite, general enough to survive future tasks. No preamble.',
  '',
  'RESPONSE FORMAT — this is mandatory and machine-parsed:',
  'Your ENTIRE response must be ONE JSON object and nothing else.',
  'Start directly with "{" and end with "}".',
  '{"rules": ["<rule one>", "<rule two>", "<rule three, optional>"]}',
].join('\n')

/**
 * Directive distillation: turns what the coach learned about the user's
 * prompting habits into imperatives for the AGENT — so the agent compensates
 * on the user's behalf on every turn instead of the user changing how they
 * write. One tiny call every `directiveEvery` analyses.
 */
export const DIRECTIVE_SYSTEM_PROMPT = [
  'You write directives for a coding agent about ONE specific user, based on',
  'how that user tends to under-specify their prompts (learned from past',
  'analyses) and how they corrected the agent afterwards.',
  '',
  'Each directive tells the AGENT what to assume, check, or do differently for',
  'this user so the user does not have to write it every time. Good directives',
  'are specific and actionable: "When the user names a feature but no files,',
  'grep the repo for it before asking." Bad directives restate generic best',
  'practice ("be helpful"). Never contradict explicit instructions in a prompt.',
  'Directives must REDUCE the user\'s effort: prefer "assume X", "check Y',
  'first", "do Z without asking". NEVER tell the agent to stop and ask the user',
  'unless the information is genuinely undiscoverable from the repo, the',
  'conversation, or the user\'s habits. Never target one wording (e.g. a bare',
  '"continue" — that is fine; the conversation is the context).',
  'Directives must GENERALIZE across future tasks: never mention a specific',
  'task, file, feature, number, or test from one past prompt — describe the',
  'habit and the compensation. Prefer the most frequent habits. 2-4 directives,',
  'one sentence each, imperative mood, addressed to the agent. You are writing',
  'the COMPLETE new set: keep existing directives that still hold (reworded if',
  'sharper), drop ones that were one-off, add what is missing. No preamble.',
].join('\n')

export function buildDirectiveUserText(profile, recentReports = []) {
  const lines = ['=== RECURRING PROMPT HABITS (kind, times seen, latest example) ===']
  const patterns = Array.isArray(profile?.patterns) ? profile.patterns.slice(0, 12) : []
  if (patterns.length === 0) lines.push('(none yet)')
  for (const pattern of patterns) {
    lines.push('- ' + String(pattern.kind) + ' (' + String(pattern.count ?? 0) + 'x): ' + clipSafe(String(pattern.lastExample ?? ''), 200))
  }
  const corrections = (Array.isArray(recentReports) ? recentReports : [])
    .filter((report) => typeof report?.followUp === 'string' && report.followUp.length > 0)
    .slice(-5)
  if (corrections.length > 0) {
    lines.push('', '=== RECENT CORRECTIONS (prompt → what the user said next) ===')
    for (const report of corrections) {
      lines.push('- "' + clipSafe(String(report.promptExcerpt ?? ''), 120) + '" → "' + clipSafe(report.followUp, 200) + '"')
    }
  }
  const rules = Array.isArray(profile?.styleRules) ? profile.styleRules.filter((rule) => typeof rule?.rule === 'string' && rule.rule.length > 0) : []
  if (rules.length > 0) {
    lines.push('', '=== STYLE RULES THE USER CONFIRMED ===')
    for (const rule of rules) lines.push('- ' + clipSafe(rule.rule, 300))
  }
  const existing = Array.isArray(profile?.directives) ? profile.directives.filter((entry) => typeof entry?.text === 'string' && entry.text.length > 0) : []
  if (existing.length > 0) {
    lines.push('', '=== CURRENT DIRECTIVES (keep the ones that still hold) ===')
    for (const entry of existing) lines.push('- ' + clipSafe(entry.text, DIRECTIVE_MAX_CHARS))
  }
  lines.push('', 'Write 2-4 directives for the agent about this user.')
  return lines.join('\n')
}

/** A directive that makes the agent stop and ask — the opposite of compensating for the user. */
export const ASKS_USER_RE = /\b(ask|confirm with|check with|clarify with|verify with|get (approval|confirmation|permission) from) (the )?user\b|\bstop and ask\b|\bbefore doing anything\b|\bask (what|which|whether|if|for)\b/i

/**
 * Parse a directives payload into clipped, deduped one-liners (≤4 kept);
 * directives that instruct the agent to ask the user are rejected.
 */
export function classifyDirectives(text) {
  const parsed = parseJsonObject(text)
  const raw = parsed !== null && Array.isArray(parsed.directives) ? parsed.directives : null
  if (raw === null) return { kept: [], rejected: [] }
  const seen = new Set()
  const kept = []
  const rejected = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const value = clipSafe(item.trim(), DIRECTIVE_MAX_CHARS)
    const key = value.toLowerCase()
    if (value.length === 0 || seen.has(key)) continue
    seen.add(key)
    if (ASKS_USER_RE.test(value)) {
      rejected.push(value)
      continue
    }
    kept.push(value)
    if (kept.length >= 4) break
  }
  return { kept, rejected }
}

export function normalizeDirectives(text) {
  return classifyDirectives(text).kept
}

/**
 * The system-prompt section: what the agent is told about this user.
 * '' when nothing is enabled (an empty section contributes nothing).
 */
export function renderSteeringSection(profile) {
  const enabled = (Array.isArray(profile?.directives) ? profile.directives : [])
    .filter((entry) => entry !== null && typeof entry === 'object' && entry.enabled !== false && entry.status !== 'retired'
      && typeof entry.text === 'string' && entry.text.trim().length > 0)
  if (enabled.length === 0) return ''
  const header = [
    '## About this user (learned by Tacit from their past prompts)',
    'This user tends to leave the following unsaid. Compensate silently when the',
    'answer is discoverable; ask only when it is not. Explicit instructions in',
    'the prompt always win over these notes.',
  ]
  const lines = [...header]
  let length = lines.join('\n').length
  for (const entry of enabled.slice(0, MAX_DIRECTIVES)) {
    const line = '- ' + clipSafe(entry.text.trim(), DIRECTIVE_MAX_CHARS)
    if (length + line.length + 1 > STEERING_MAX_CHARS) break
    lines.push(line)
    length += line.length + 1
  }
  return lines.length > header.length ? lines.join('\n') : ''
}

/** Build the distillation user text from verbatim rejected-improvement reasons. */
export function buildDistillUserText(reasons) {
  const list = (Array.isArray(reasons) ? reasons : [])
    .filter((reason) => typeof reason === 'string' && reason.length > 0)
    .slice(0, 3)
    .map((reason) => '- ' + reason.slice(0, MAX_FEEDBACK_REASON_CHARS))
  const lines = [
    '=== REJECTED-IMPROVEMENT REASONS (verbatim) ===',
    ...(list.length > 0 ? list : ['(none recorded)']),
    '',
    'Distill these into 2-3 durable style rules for rewriting user prompts.',
    'Return ONLY the JSON object.',
  ]
  return lines.join('\n')
}

/**
 * Normalize a distillation response into 0..3 clipped, deduped rule strings.
 * Returns [] when the model produced nothing usable (soft no-op).
 */
export function normalizeDistillRules(text) {
  if (typeof text !== 'string') return []
  const parsed = parseJsonObject(text)
  const raw = parsed !== null && Array.isArray(parsed.rules) ? parsed.rules : null
  if (raw === null) return []
  const seen = new Set()
  const rules = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const rule = item.trim().slice(0, 300)
    if (rule.length === 0 || seen.has(rule.toLowerCase())) continue
    seen.add(rule.toLowerCase())
    rules.push(rule)
    if (rules.length >= DISTILL_MAX_RULES) break
  }
  return rules
}

/** Compact, bounded digest of a turn for the coach prompt. */
export function digestTurn(turn) {
  if (turn === null || typeof turn !== 'object') return null
  const usage = turn.usage !== null && typeof turn.usage === 'object' ? turn.usage : {}
  const tools = Array.isArray(turn.toolCalls) ? turn.toolCalls : []
  return {
    turn: typeof turn.turn === 'number' ? turn.turn : 0,
    prompt: typeof turn.prompt === 'string' ? turn.prompt : '',
    steps: typeof turn.steps === 'number' ? turn.steps : 0,
    retries: typeof turn.retries === 'number' ? turn.retries : 0,
    compactions: typeof turn.compactions === 'number' ? turn.compactions : 0,
    toolErrors: typeof turn.toolErrors === 'number' ? turn.toolErrors : 0,
    toolCalls: tools.slice(0, 25).map((call) => ({
      name: typeof call?.name === 'string' ? call.name : '?',
      args: typeof call?.args === 'string' ? call.args.slice(0, 400) : '',
    })),
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? 0,
    },
    finalText: typeof turn.finalText === 'string' ? turn.finalText.slice(0, 3000) : '',
    model: typeof turn.model === 'string' ? turn.model : '',
  }
}

/** Finished turn with rework signals or a long run of model steps. */
export function isMessyTurn(turn, { minSteps = 15 } = {}) {
  if (turn === null || typeof turn !== 'object' || turn.finished !== true) return false
  const n = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  if (n(turn.retries) > 0 || n(turn.toolErrors) > 0 || n(turn.compactions) > 0) return true
  if (turn.endReason === 'rejected' || turn.endReason === 'cancelled') return true
  return n(turn.steps) >= Math.max(1, minSteps)
}

const CORRECTION_START = /^(no\b|nope\b|not\b|wrong\b|that'?s not\b|thats not\b|i meant\b|i said\b|i didn'?t\b|why (did|are|is|do)\b|what are you doing\b|stop\b|undo\b|revert\b|still\b|again\b|instead\b|不对|不是|错了|我是说|为什么)/i
const CORRECTION_ANY = /\b(i meant|not what i (asked|meant|wanted)|that'?s not|you (didn'?t|did not|ignored|missed)|why did you|wrong (file|folder|branch|approach)|is it stuck|why is it stuck|doesn'?t work|didn'?t work)\b|我是说|不是这个|为什么/i
export const CORRECTION_MAX_CHARS = 300

/** Cheap heuristic: does this next user message read as a correction of the agent? */
export function looksLikeCorrection(text) {
  if (typeof text !== 'string') return false
  const value = text.trim()
  if (value.length === 0 || value.length > CORRECTION_MAX_CHARS) return false
  return CORRECTION_START.test(value) || CORRECTION_ANY.test(value)
}

const CONTINUATION_RE = /^(continue|go ahead|go on|proceed|next|carry on|keep going|yes|yep|yeah|ok(ay)?|do it|sure|please (continue|proceed)|继续|好的|可以|接着来)[.!\s]*$/i
/** A bare continuation ("continue", "go ahead", "yes") — adequate whenever the previous turn supplies context. */
export function looksLikeContinuation(text) {
  if (typeof text !== 'string') return false
  const value = text.trim()
  if (value.length === 0) return false
  if (CONTINUATION_RE.test(value)) return true
  // A short message that OPENS with a continuation phrase ("go ahead make the plan").
  const words = value.split(/\s+/).filter((word) => word.length > 0)
  return words.length <= 6 && /^(continue|go ahead|go on|proceed|carry on|keep going|yes|yep|ok(ay)?|do it|sure|please (continue|proceed)|继续|好的|可以)\b/i.test(value)
}

export function buildAnalysisUserText(turn, { followUp, previous } = {}) {
  const digest = digestTurn(turn)
  if (digest === null) return null
  const lines = []
  if (previous !== null && typeof previous === 'object') {
    const previousPrompt = typeof previous.prompt === 'string' ? previous.prompt : ''
    const previousAnswer = typeof previous.finalText === 'string' ? previous.finalText : ''
    lines.push('=== PREVIOUS TURN (context the agent already had) ===')
    lines.push('prompt: ' + (previousPrompt.length > 0 ? clipSafe(previousPrompt, 600) : '(none)'))
    lines.push('answer: ' + (previousAnswer.length > 0 ? clipSafe(previousAnswer, 600) : '(none)'))
    lines.push('')
  }
  lines.push(
    '=== ORIGINAL PROMPT (turn ' + digest.turn + ') ===',
    digest.prompt || '(no text)',
  )
  if (looksLikeContinuation(digest.prompt)) {
    lines.push('Note: this prompt is a continuation of the previous turn; judge it with that context, not in isolation.')
  }
  lines.push(
    '',
    '=== TRAJECTORY DIGEST ===',
    '- steps (model calls): ' + digest.steps,
    '- tool calls: ' + digest.toolCalls.length,
    '- tool errors: ' + digest.toolErrors,
    '- retries: ' + digest.retries,
    '- compactions: ' + digest.compactions,
    '- tokens: input ' + digest.usage.inputTokens
      + ', output ' + digest.usage.outputTokens
      + ', reasoning ' + digest.usage.reasoningTokens
      + ', cacheRead ' + digest.usage.cacheReadTokens,
    '- model: ' + (digest.model || '(unknown)'),
  )
  if (digest.toolCalls.length > 0) {
    lines.push('', '--- tool calls (name + argument preview) ---')
    for (const call of digest.toolCalls) {
      lines.push('- ' + call.name + ': ' + call.args)
    }
  }
  lines.push('', '=== FINAL RESPONSE EXCERPT ===')
  lines.push(digest.finalText || '(none)')
  if (typeof followUp === 'string' && followUp.trim().length > 0) {
    lines.push('', "=== USER'S NEXT MESSAGE (sent right after this answer — likely a correction) ===")
    lines.push(clipSafe(followUp.trim(), 1000))
  }
  return lines.join('\n')
}

export function buildImproveUserText({ draft, profile, recentContext, styleRules, negativeFeedback }) {
  const patterns = Array.isArray(profile?.patterns) ? profile.patterns : []
  const lines = []
  const rules = Array.isArray(styleRules) ? styleRules.filter((rule) => rule !== null && typeof rule === 'object' && typeof rule.rule === 'string' && rule.rule.length > 0) : []
  if (rules.length > 0) {
    lines.push('=== STYLE RULES (learned from your feedback — follow these) ===')
    for (const entry of rules) lines.push('- ' + entry.rule.slice(0, 300))
    lines.push('')
  }
  const negatives = Array.isArray(negativeFeedback) ? negativeFeedback.filter((reason) => typeof reason === 'string' && reason.length > 0).slice(0, 3) : []
  if (negatives.length > 0) {
    lines.push('=== NEGATIVE FEEDBACK (verbatim — do not repeat these mistakes) ===')
    negatives.forEach((reason, index) => {
      lines.push(index === 0
        ? '- your last suggestion was rejected because: ' + reason.slice(0, MAX_FEEDBACK_REASON_CHARS)
        : '- an earlier suggestion was rejected because: ' + reason.slice(0, MAX_FEEDBACK_REASON_CHARS))
    })
    lines.push('')
  }
  if (patterns.length > 0) {
    lines.push('=== RECURRING MISTAKE PATTERNS LEARNED FROM PAST ANALYSES ===')
    for (const pattern of patterns.slice(0, 12)) {
      lines.push('- ' + (typeof pattern.kind === 'string' ? pattern.kind : 'general')
        + ' (seen ' + (typeof pattern.count === 'number' ? pattern.count : 0) + 'x): '
        + (typeof pattern.lastExample === 'string' ? pattern.lastExample.slice(0, 200) : ''))
    }
    lines.push('')
  }
  if (typeof recentContext === 'string' && recentContext.length > 0) {
    lines.push('=== RECENT CONVERSATION CONTEXT ===')
    lines.push(recentContext.slice(0, 1500))
    lines.push('')
  }
  lines.push('=== DRAFT TO IMPROVE ===')
  lines.push(draft)
  return lines.join('\n')
}

/** Strip markdown fences and parse the first {...} JSON object in the text. */
export function parseJsonObject(text) {
  if (typeof text !== 'string') return null
  let value = text.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(value)
  if (fence !== null) value = fence[1].trim()
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(value.slice(start, end + 1))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

const clampPct = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(90, Math.round(number)))
}

const clipText = (value, max) => {
  const text = typeof value === 'string' ? value : ''
  return text.length <= max ? text : text.slice(0, max)
}

/** Shape a parsed analysis object into a report (falls back gracefully). */
export function normalizeReport(parsed, { turn, time, model, rawText }) {
  if (parsed === null) {
    return {
      ok: true,
      turn,
      time,
      model,
      problems: [{
        kind: 'notes',
        severity: 'info',
        what: clipText(rawText, 4000),
        why: '',
      }],
      improvedPrompt: '',
      explanation: '',
      estimatedTokenSavingPct: 0,
    }
  }
  const result = analysisReportShape.safeParse(parsed)
  const shaped = result.success ? result.data : { problems: [], improvedPrompt: '', explanation: '', estimatedTokenSavingPct: 0 }
  const problems = shaped.problems.slice(0, 12).map((problem) => ({
    kind: clipText(problem.kind, 60) || 'general',
    severity: ['high', 'medium', 'low'].includes(String(problem.severity)) ? problem.severity : 'medium',
    what: clipText(problem.what, 600),
    why: clipText(problem.why, 600),
  }))
  return reportSchema.parse({
    ok: true,
    turn,
    time,
    model,
    problems,
    improvedPrompt: clipText(shaped.improvedPrompt, 8000),
    explanation: clipText(shaped.explanation, 2000),
    estimatedTokenSavingPct: clampPct(shaped.estimatedTokenSavingPct),
  })
}

export function normalizeImprove(parsed, draft) {
  const fallback = { improved: draft, rationale: '', savingsEstimate: 0 }
  if (parsed === null) return fallback
  const result = improveShape.safeParse(parsed)
  const shaped = result.success ? result.data : fallback
  const improved = clipText(shaped.improved, 20000).trim()
  return {
    improved: improved.length > 0 ? improved : draft,
    rationale: clipText(shaped.rationale, 1000),
    savingsEstimate: clampPct(shaped.savingsEstimate),
  }
}

const normalizeKind = (value) => {
  const kind = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40)
  return kind.length > 0 ? kind : 'general'
}

/**
 * Deterministic aggregation of one finished report into the mistake profile:
 * pattern counts merge by normalized kind, lastExample keeps the newest
 * text; v2 trust/feedback fields (counters, styleRules, goodExamples,
 * feedbackLog, pendingDistill) are carried over untouched — analysis never
 * erases what the self-improving loop learned. `analyzedCount` (the learning
 * gate) increments only for a NEWLY analyzed turn (`countNew`), so
 * re-coaching the same prompt never double counts. No second model call.
 */
export function aggregateProfile(prev, report, maxPatterns, options = {}) {
  const countNew = options.countNew !== false
  const patterns = new Map()
  for (const pattern of Array.isArray(prev?.patterns) ? prev.patterns : []) {
    if (pattern !== null && typeof pattern === 'object' && typeof pattern.kind === 'string') {
      patterns.set(normalizeKind(pattern.kind), {
        kind: normalizeKind(pattern.kind),
        count: typeof pattern.count === 'number' && pattern.count > 0 ? pattern.count : 0,
        lastExample: typeof pattern.lastExample === 'string' ? pattern.lastExample : '',
        applied: counterOf(pattern, 'applied'),
        accepted: counterOf(pattern, 'accepted'),
        rejected: counterOf(pattern, 'rejected'),
        verified: counterOf(pattern, 'verified'),
        unverified: counterOf(pattern, 'unverified'),
      })
    }
  }
  const problems = Array.isArray(report?.problems) ? report.problems : []
  for (const problem of problems) {
    if (problem === null || typeof problem !== 'object') continue
    const kind = normalizeKind(problem.kind)
    const current = patterns.get(kind) ?? {
      kind,
      count: 0,
      lastExample: '',
      applied: 0,
      accepted: 0,
      rejected: 0,
      verified: 0,
      unverified: 0,
    }
    current.count += 1
    if (typeof problem.what === 'string' && problem.what.length > 0) current.lastExample = problem.what.slice(0, 200)
    patterns.set(kind, current)
  }
  const sorted = [...patterns.values()].sort((a, b) => b.count - a.count).slice(0, maxPatterns)
  return profileSchema.parse({
    analyzedCount: (typeof prev?.analyzedCount === 'number' ? prev.analyzedCount : 0) + (countNew ? 1 : 0),
    patterns: sorted,
    updatedAt: Date.now(),
    styleRules: Array.isArray(prev?.styleRules) ? prev.styleRules : [],
    goodExamples: Array.isArray(prev?.goodExamples) ? prev.goodExamples : [],
    feedbackLog: Array.isArray(prev?.feedbackLog) ? prev.feedbackLog : [],
    pendingDistill: typeof prev?.pendingDistill === 'number' && prev.pendingDistill >= 0 ? Math.round(prev.pendingDistill) : 0,
    directives: Array.isArray(prev?.directives) ? prev.directives : [],
    analysesSinceDirectives: typeof prev?.analysesSinceDirectives === 'number' && prev.analysesSinceDirectives >= 0 ? Math.round(prev.analysesSinceDirectives) : 0,
  })
}

export function profileReady(profile, threshold) {
  return (typeof profile?.analyzedCount === 'number' ? profile.analyzedCount : 0) >= threshold
}

// ── Trust & selection (v2 self-improving loop) ─────────────────────────────

const counterOf = (pattern, key) => {
  const value = pattern !== null && typeof pattern === 'object' ? pattern[key] : undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}

/**
 * Pure trust score for one pattern: the acceptance/verification weighted
 * ratio minus the rejection/unverification ratio, normalized by applied+1
 * so a pattern with no samples is neutral (0), never divide-by-zero.
 *
 *   trust = ((accepted + 2·verified) − (rejected + unverified)) / (applied + 1)
 */
export function trustScore(pattern) {
  if (pattern === null || typeof pattern !== 'object') return 0
  const applied = counterOf(pattern, 'applied')
  const accepted = counterOf(pattern, 'accepted')
  const rejected = counterOf(pattern, 'rejected')
  const verified = counterOf(pattern, 'verified')
  const unverified = counterOf(pattern, 'unverified')
  if (applied + accepted + rejected + verified + unverified === 0) return 0
  return ((accepted + 2 * verified) - (rejected + unverified)) / (applied + 1)
}

/**
 * The patterns offered to the improve prompt. Deterministic top-k:
 *  - patterns with >= TRUST_MIN_APPLIED applied samples only stay when their
 *    trust is > 0 ("trusted" — the coach stops repeating advice that failed);
 *  - patterns with fewer applied samples are still inexperienced and rank by
 *    count, exactly as before the loop existed.
 * Trusted patterns come first (by trust desc), then rookies (by count desc).
 */
export function improvePatterns(profile, maxPatterns) {
  const patterns = Array.isArray(profile?.patterns) ? profile.patterns : []
  const cap = Number.isFinite(maxPatterns) && maxPatterns > 0 ? Math.round(maxPatterns) : 12
  const rookies = []
  const seasoned = []
  for (const pattern of patterns) {
    if (pattern === null || typeof pattern !== 'object' || typeof pattern.kind !== 'string') continue
    if (counterOf(pattern, 'applied') < TRUST_MIN_APPLIED) rookies.push(pattern)
    else seasoned.push(pattern)
  }
  const trusted = seasoned
    .filter((pattern) => trustScore(pattern) > 0)
    .sort((a, b) => trustScore(b) - trustScore(a) || (b.count ?? 0) - (a.count ?? 0))
  const byCount = (a, b) => (b.count ?? 0) - (a.count ?? 0)
  return [...trusted, ...rookies.sort(byCount)].slice(0, cap)
}

/** The last `n` verbatim down-reasons (newest first), each clipped to 300 chars. */
export function lastDownReasons(profile, n = 3) {
  const log = Array.isArray(profile?.feedbackLog) ? profile.feedbackLog : []
  const downs = log.filter((entry) => (
    entry !== null && typeof entry === 'object'
    && entry.verdict === 'down' && typeof entry.reason === 'string' && entry.reason.length > 0
  ))
  return downs.slice(-n).reverse().map((entry) => entry.reason.slice(0, MAX_FEEDBACK_REASON_CHARS))
}

/**
 * Call the coach model through the harness's own LLM waterfall (the harness
 * resolves the user's configured DeepSeek API key — never this plugin).
 *
 * Cheap and structured: low reasoning effort, and when a `tool` schema is
 * given the model answers by calling it — the tool-call arguments (raw JSON)
 * are returned. Plain text is the fallback channel. Reasoning deltas are
 * NEVER returned as the answer (chain of thought is not a report). A
 * deployment that rejects the reasoning effort gets one retry without it.
 * Returns the answer text ('' when the model produced nothing usable).
 */
export async function callCoachModel(ctx, { provider, model, system, userText, maxTokens, timeoutMs, tool, sessionId, reasoningEffort = COACH_REASONING_EFFORT }) {
  const llm = ctx.get !== undefined && typeof ctx.get === 'function' ? ctx.get('llm') : undefined
  if (llm === undefined || typeof llm.stream !== 'function') {
    const error = new Error('the harness LLM service is unavailable')
    error.code = 'no-llm'
    throw error
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const message = createUserMessage({
    content: [{ type: 'text', text: userText }],
    source: { kind: 'plugin', plugin: 'dsh-tacit' },
  })
  const run = async (effort) => {
    let text = ''
    let toolArgs = ''
    let toolDeltas = ''
    let finish = ''
    for await (const chunk of llm.stream({
      provider,
      model,
      messages: [message],
      system,
      maxTokens,
      signal: controller.signal,
      ...(effort !== undefined ? { reasoningEffort: effort } : {}),
      ...(tool !== undefined ? { tools: [tool] } : {}),
      ...(typeof sessionId === 'string' && sessionId.length > 0 ? { sessionId } : {}),
    })) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'finish' && typeof chunk.reason === 'string') finish = chunk.reason
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'tool-call-delta' && typeof chunk.argumentsDelta === 'string') toolDeltas += chunk.argumentsDelta
      else if (chunk.type === 'block-end' && chunk.block !== null && typeof chunk.block === 'object'
        && chunk.block.type === 'tool-call' && typeof chunk.block.arguments === 'string' && toolArgs === '') {
        toolArgs = chunk.block.arguments
      }
    }
    if (toolArgs.length > 0) return toolArgs
    if (toolDeltas.length > 0) return toolDeltas
    if (text.length === 0 && finish.length > 0 && finish !== 'stop') {
      console.warn('[tacit] model call ended without an answer (finish: ' + finish + ', maxTokens: ' + String(maxTokens) + ')')
    }
    return text
  }
  try {
    try {
      return await run(reasoningEffort)
    } catch (error) {
      const code = error !== null && typeof error === 'object' ? error.code : undefined
      if (reasoningEffort !== undefined && code === 'UNSUPPORTED_REASONING_EFFORT') return await run(undefined)
      throw error
    }
  } finally {
    clearTimeout(timer)
  }
}
