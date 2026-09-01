// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — audit of this repo's own public GitHub Actions logs.
 *
 * The maintainer ships under a pseudonym, so a run log must never carry a real
 * name, an email, a developer home path, an API key, a token, or the contents
 * of a credential file. `scanLines` is the pure, unit-tested half. It runs a
 * table of credential and identity shapes plus a literal deny list of the
 * maintainer's own words read from TACIT_LOG_DENY. The CLI half fetches the
 * last N runs with `gh`, strips the `job<TAB>step<TAB>timestamp ` columns gh
 * prefixes to every line so only the message is scanned, and prints the hits.
 *
 *   node scripts/check-ci-logs.mjs                 # the last 10 runs
 *   node scripts/check-ci-logs.mjs --runs 40       # a deeper sweep
 *   TACIT_LOG_DENY='ada,lovelace' node scripts/check-ci-logs.mjs
 */

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// No row carries /g. One regex is reused across every line, and a global one
// keeps `lastIndex` between `.test()` calls, silently skipping every other hit.
/** Credential and identity shapes; a row's `allow` makes a hit on the same line benign. */
export const RULES = [
  { name: 'aws-key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'github-token', pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{30,}/ },
  { name: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/ },
  { name: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY/ },
  { name: 'url-token', pattern: /[?&](token|api_key|apikey|key|secret)=[^&\s*]{8,}/ },
  {
    name: 'auth-header',
    pattern: /\b(authorization|x-api-key)\s*[:=]\s*(basic|bearer)?\s*[A-Za-z0-9+/=_-]{16,}/i,
    allow: /\*\*\*/,
  },
  {
    name: 'email',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    allow: /users\.noreply\.github\.com|@github\.com|actions@|noreply@|dependabot/,
  },
  { name: 'home-path', pattern: /(\/Users\/[^/\s]+|\/home\/(?!runner\b)[^/\s]+|C:\\Users\\[^\\\s]+)/ },
  {
    name: 'credential-file',
    pattern: /\.credentials\.ya?ml|anonymous-user-id|DEEPSEEK_API_KEY\s*[:=]\s*\S{8,}/,
    allow: /\*\*\*/,
  },
]

// The deny list is input, so a RegExp built from it is a CodeQL finding as well
// as an injection. Plain case-folded `includes` is the whole matcher.
function denyWords() {
  return (process.env.TACIT_LOG_DENY ?? '')
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0)
}

/** Every rule hit in `lines`, as `{ rule, line, text, match }` with a 1-based line number. */
export function scanLines(lines) {
  const deny = denyWords()
  const findings = []
  for (let at = 0; at < lines.length; at += 1) {
    const text = lines[at]
    if (typeof text !== 'string') continue
    for (const rule of RULES) {
      const hit = rule.pattern.exec(text)
      if (hit === null) continue
      if (rule.allow !== undefined && rule.allow.test(text)) continue
      findings.push({ rule: rule.name, line: at + 1, text, match: hit[0] })
    }
    const lowered = text.toLowerCase()
    const word = deny.find((candidate) => lowered.includes(candidate))
    if (word !== undefined) {
      const start = lowered.indexOf(word)
      findings.push({ rule: 'deny-words', line: at + 1, text, match: text.slice(start, start + word.length) })
    }
  }
  return findings
}

/** The finding's line with the offending span replaced, so the audit never repeats what it found. */
export function redactFinding(finding) {
  const start = finding.text.indexOf(finding.match)
  const masked = start === -1
    ? '[' + finding.rule + ']'
    : finding.text.slice(0, start) + '[' + finding.rule + ']' + finding.text.slice(start + finding.match.length)
  return masked.replace(/\s+/g, ' ').trim().slice(0, 160)
}

const LOG_PREFIX = /^\uFEFF?\d{4}-\d{2}-\d{2}T[\d:.]+Z /
// `gh run view --log` streams a whole run; past maxBuffer spawnSync truncates
// and reports it as a spawn error, which would read here as an unreachable log.
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024

/** The message half of each `job<TAB>step<TAB>timestamp message` row, tabs in the message and all. */
function logMessages(log) {
  const rows = log.split('\n')
  if (rows.at(-1) === '') rows.pop()
  return rows.map((row) => {
    const firstTab = row.indexOf('\t')
    const secondTab = firstTab === -1 ? -1 : row.indexOf('\t', firstTab + 1)
    return (secondTab === -1 ? row : row.slice(secondTab + 1)).replace(LOG_PREFIX, '')
  })
}

function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 120)
}

// `node -e` and the REPL leave argv[1] undefined, and pathToFileURL throws on it.
const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  const args = process.argv.slice(2)
  let runsArg = '10'
  for (let at = 0; at < args.length; at += 1) {
    if (args[at] === '--runs') {
      runsArg = args[at + 1] ?? ''
      at += 1
    }
  }
  const runCount = Number(runsArg)
  if (!Number.isInteger(runCount) || runCount < 1) {
    console.error('--runs needs an integer >= 1, got "' + runsArg + '"')
    process.exit(2)
  }

  const listed = spawnSync('gh', [
    'run', 'list',
    '--limit', String(runCount),
    '--json', 'databaseId,workflowName,conclusion',
  ], { encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES })
  if (listed.error !== undefined || listed.status !== 0) {
    console.error('gh run list failed, install the GitHub CLI and run `gh auth login` — ' + oneLine(listed.stderr ?? listed.error?.message ?? ''))
    process.exit(2)
  }

  let runs = []
  try {
    runs = JSON.parse(listed.stdout)
  } catch {
    console.error('gh run list returned output that is not JSON — check `gh auth status`')
    process.exit(2)
  }

  console.log('tacit ci log audit — ' + runs.length + ' run(s)\n')

  let lineTotal = 0
  let findingTotal = 0
  let scanned = 0
  for (const run of runs) {
    const label = run.workflowName + ' #' + run.databaseId
    const view = spawnSync('gh', ['run', 'view', String(run.databaseId), '--log'], {
      encoding: 'utf8',
      maxBuffer: MAX_OUTPUT_BYTES,
    })
    if (view.error !== undefined || view.status !== 0) {
      console.log('SKIP  ' + label + ' (no log available)')
      continue
    }
    const messages = logMessages(view.stdout ?? '')
    scanned += 1
    lineTotal += messages.length
    const findings = scanLines(messages)
    if (findings.length === 0) {
      console.log('PASS  ' + label + ' (' + messages.length + ' lines)')
      continue
    }
    findingTotal += findings.length
    for (const finding of findings) {
      console.log('FAIL  ' + label + '  line ' + finding.line + '  ' + finding.rule + ': ' + redactFinding(finding))
    }
  }

  if (scanned === 0) {
    console.log('\nLOG AUDIT FAIL ✖ (no run log could be read)')
    process.exit(1)
  }
  console.log('\n' + (findingTotal === 0
    ? 'LOG AUDIT PASS ✔ (' + lineTotal + ' lines over ' + scanned + ' of ' + runs.length + ' runs)'
    : 'LOG AUDIT FAIL ✖ (' + findingTotal + (findingTotal === 1 ? ' finding' : ' findings') + ' over ' + scanned + ' of ' + runs.length + ' runs)'))
  process.exit(findingTotal === 0 ? 0 : 1)
}
