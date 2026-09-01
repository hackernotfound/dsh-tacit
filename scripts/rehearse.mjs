// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * Live rehearsal of Tacit's zero-click loop against a REAL dsh harness, with
 * REAL model calls, in a throwaway DSH_HOME — no browser, no `dsh web`. Packs
 * this repo, installs the tarball into a headless profile, seeds one directive
 * on trial, drives N headless turns whose file read is meant to fail (a messy
 * turn is what triggers auto-analysis), then reads what Tacit landed on disk
 * (auto ledger, reports, profile trial, usage day file, summary) and asserts on
 * that. The live counterpart of `pnpm smoke`, which only hits the HTTP routes
 * of an already running `dsh web`.
 *
 * Needs a DeepSeek API key configured in the harness: `.credentials.yaml` (and
 * `settings.yaml` when present) are copied out of the real home into the
 * throwaway one, which is deleted again on the way out. Nothing else touches
 * the real home. Costs about $0.001 in Tacit calls per run, on top of the
 * agent's own turns.
 *
 *   pnpm rehearse                          # 2 turns against @deepseek-ai/dsh@latest
 *   pnpm rehearse --turns 10               # a full trial (directiveTrialTurns)
 *   pnpm rehearse --dsh 0.1.1-rc.2         # pin the harness version
 *   TACIT_REHEARSE_DSH=next pnpm rehearse  # same, from the environment
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { profileSchema } from '../lib/schema.js'
import { dayKey } from '../lib/store.js'

const TASK = 'Read the file ./tacit-probe-missing.txt with your file tool and report its first line verbatim. If the read fails, say exactly why in one sentence.'
const DIRECTIVE_ID = 'dir-rehearsal-seed'
const STEP_TIMEOUT_MS = 300000
// spawnSync truncates past maxBuffer and reports it as a spawn error, which would read as a failed turn.
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024

const args = process.argv.slice(2)
let dshTag = process.env.TACIT_REHEARSE_DSH || 'latest'
let turnsArg = '2'
for (let at = 0; at < args.length; at += 1) {
  if (args[at] === '--dsh') {
    dshTag = args[at + 1] ?? ''
    at += 1
  } else if (args[at] === '--turns') {
    turnsArg = args[at + 1] ?? ''
    at += 1
  }
}
const TURNS = Number(turnsArg)
if (!Number.isInteger(TURNS) || TURNS < 1) {
  console.error('--turns needs an integer >= 1, got "' + turnsArg + '"')
  process.exit(2)
}

let failures = 0
function check(name, condition, detail) {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined ? ' — ' + detail : ''))
  if (!condition) failures += 1
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Everything the runs left behind, parsed once so every assertion reads one record. */
function readLanded(tacitDir, day) {
  const reportsDir = path.join(tacitDir, 'reports')
  const reports = []
  let sessionDirs = []
  try {
    sessionDirs = fs.readdirSync(reportsDir)
  } catch {
    sessionDirs = []
  }
  for (const session of sessionDirs) {
    let names = []
    try {
      names = fs.readdirSync(path.join(reportsDir, session))
    } catch {
      continue
    }
    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue
      const report = readJson(path.join(reportsDir, session, name))
      if (report !== null) reports.push(report)
    }
  }
  return {
    auto: readJson(path.join(tacitDir, 'auto.json')),
    reports,
    profile: readJson(path.join(tacitDir, 'profile.json')),
    usageDay: readJson(path.join(tacitDir, 'usage', day + '.json')),
    summary: readJson(path.join(tacitDir, 'usage', 'summary.json')),
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const sourceCredentials = path.join(sourceHome, '.credentials.yaml')
const sourceSettings = path.join(sourceHome, 'settings.yaml')
if (!fs.existsSync(sourceCredentials)) {
  console.error('no harness credentials at ' + sourceCredentials)
  console.error('configure a DeepSeek API key in the harness first, then run this again.')
  process.exit(2)
}

const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tacit-rehearse-pack-'))
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tacit-rehearse-'))
const tacitDir = path.join(home, 'storages', 'tacit')

console.log('tacit live rehearsal — dsh@' + dshTag + ', ' + TURNS + ' turn(s), DSH_HOME ' + home)

let fatal = ''
try {
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: root, encoding: 'utf8' })
  if (packed.status !== 0) {
    process.stderr.write(packed.stderr ?? '')
    throw new Error('npm pack failed (status ' + packed.status + ')')
  }
  const tarball = path.join(packDir, JSON.parse(packed.stdout)[0].filename)
  console.log('packed ' + path.basename(tarball))

  fs.copyFileSync(sourceCredentials, path.join(home, '.credentials.yaml'))
  if (fs.existsSync(sourceSettings)) fs.copyFileSync(sourceSettings, path.join(home, 'settings.yaml'))

  const seededAt = Date.now()
  fs.mkdirSync(tacitDir, { recursive: true })
  const seededProfile = profileSchema.parse({
    analyzedCount: 0,
    patterns: [],
    updatedAt: 0,
    styleRules: [],
    feedbackLog: [],
    pendingDistill: 0,
    analysesSinceDirectives: 0,
    directives: [{
      id: DIRECTIVE_ID,
      text: 'Name the absolute path of every file you read.',
      enabled: true,
      source: 'distilled',
      status: 'candidate',
      createdAt: seededAt,
      updatedAt: seededAt,
      trial: { turns: 0, messy: 0, corrected: 0, baselineMessyRate: 0.3, baselineCorrectionRate: -1, startedAt: seededAt },
    }],
  })
  fs.writeFileSync(path.join(tacitDir, 'profile.json'), JSON.stringify(seededProfile, null, 2), 'utf8')

  const install = spawnSync('npx', ['--yes', '@deepseek-ai/dsh@' + dshTag, 'plugin', '--profile', 'headless', 'add', tarball], {
    encoding: 'utf8',
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: { ...process.env, DSH_HOME: home },
  })
  if (install.status !== 0) {
    process.stdout.write(install.stdout ?? '')
    process.stderr.write(install.stderr ?? '')
    throw new Error('installing the packed plugin into the headless profile failed (status ' + install.status + ')')
  }
  console.log('installed into the headless profile')

  const workspace = path.join(home, 'workspace')
  fs.mkdirSync(workspace, { recursive: true })

  const runs = []
  for (let index = 1; index <= TURNS; index += 1) {
    console.log('run ' + index + '/' + TURNS + ' …')
    const startedAt = Date.now()
    // macOS ships no `timeout` binary, so the bound is a spawnSync option.
    const turn = spawnSync('npx', ['--yes', '@deepseek-ai/dsh@' + dshTag, '--profile', 'headless', TASK], {
      cwd: workspace,
      encoding: 'utf8',
      timeout: STEP_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: { ...process.env, DSH_HOME: home },
    })
    console.log('run ' + index + '/' + TURNS + ' exit ' + turn.status + ' in ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's')
    runs.push({ index, stdout: turn.stdout ?? '', stderr: turn.stderr ?? '', status: turn.status })
  }

  const day = dayKey()
  const landed = readLanded(tacitDir, day)

  console.log('')
  check('boot: the plugin loaded in the headless run', (runs[0].stdout + runs[0].stderr).includes('[tacit] loaded'),
    'exit=' + runs[0].status)

  check('auto ledger: at least one automatic analysis', (landed.auto?.count ?? 0) >= 1,
    'date=' + landed.auto?.date + ' count=' + landed.auto?.count)

  check('reports: at least one trigger:auto report', landed.reports.some((report) => report?.trigger === 'auto'),
    'reports=' + landed.reports.length + ' triggers=' + landed.reports.map((report) => report?.trigger).join(','))

  const seeded = (landed.profile?.directives ?? []).find((entry) => entry?.id === DIRECTIVE_ID)
  const trial = seeded?.trial
  const stillOnTrial = seeded?.status === 'candidate' && trial?.turns === TURNS && (trial?.messy ?? 0) >= 1
  const reachedVerdict = TURNS >= 10 && ['active', 'retired'].includes(seeded?.status) && (seeded?.evaluatedAt ?? 0) > 0
  check('profile: the seeded directive recorded the trial turns', stillOnTrial || reachedVerdict,
    'status=' + seeded?.status + ' turns=' + trial?.turns + ' messy=' + trial?.messy + ' evaluatedAt=' + seeded?.evaluatedAt)

  const dayRuns = Array.isArray(landed.usageDay?.runs) ? landed.usageDay.runs : []
  const autoAnalyses = dayRuns.filter((entry) => entry?.type === 'analysis' && entry?.trigger === 'auto')
  check('usage day file: an auto analysis with a priced attempt',
    autoAnalyses.some((entry) => (entry.attempts ?? []).some((attempt) => (attempt?.priced?.usd ?? 0) > 0)),
    'day=' + day + ' runs=' + dayRuns.length + ' auto=' + autoAnalyses.length)

  check('usage summary: lifetime.attempts >= 1', (landed.summary?.lifetime?.attempts ?? 0) >= 1,
    'attempts=' + landed.summary?.lifetime?.attempts)

  let spendUsd = 0
  for (const entry of dayRuns) {
    for (const attempt of entry?.attempts ?? []) {
      if (typeof attempt?.priced?.usd === 'number') spendUsd += attempt.priced.usd
    }
  }
  const analyses = dayRuns.filter((entry) => entry?.type === 'analysis').length
  console.log('\ntacit spend: $' + spendUsd.toFixed(4) + ' over ' + analyses + ' ' + (analyses === 1 ? 'analysis' : 'analyses'))
} catch (error) {
  fatal = error?.message ?? String(error)
} finally {
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(packDir, { recursive: true, force: true })
  console.log('\nremoved the rehearsal home ' + home + ' (it held a copy of your credentials)')
}

if (fatal.length > 0) {
  console.error('\n' + fatal)
  process.exit(1)
}

console.log('\n' + (failures === 0 ? 'REHEARSAL PASS ✔' : 'REHEARSAL FAIL ✖ (' + failures + ' checks)'))
process.exit(failures === 0 ? 0 : 1)
