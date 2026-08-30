// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — local storage (plugin-owned only).
 *
 * Everything lives under $DSH_HOME/storages/tacit/:
 *   config.patch.json            UI-written config fields (loader/YAML config is the base)
 *   profile.json                 persistent user mistake profile
 *   reports/<sessionId>/<turn>.json  analysis reports
 *   usage/<YYYY-MM-DD>.json      per-day usage ledger (runs of metered model calls)
 *   usage/summary.json           rolling lifetime/byType/byModel/day totals
 *
 * Safety rules (hard constraints):
 *  - writes are atomic (temp file + rename) and never truncate an existing
 *    file in place;
 *  - this plugin deletes files down exactly two paths, both restricted to
 *    its own files: `clearReports()`, which unlinks files matching
 *    /^\d+\.json$/ inside its own reports directory (then removes that
 *    directory only if empty); and usage-day expiry / `clearUsage()`, which
 *    unlink only files matching /^\d{4}-\d{2}-\d{2}\.json$/ inside `usage/`
 *    and never remove the `usage/` directory itself — nothing else on disk
 *    is ever touched;
 *  - session ids are sanitized before touching the filesystem (no traversal).
 */

import fs from 'node:fs'
import path from 'node:path'
import { usageDayFileSchema, usageSummarySchema } from './schema.js'

/** Strictly the plugin's own usage-day file naming — nothing else may ever be unlinked from `usage/`. */
const USAGE_DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/
const USAGE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * How much summed on-disk day-file weight `readUsageDay` may keep parsed in
 * memory. Chosen so a realistic retention window is never evicted while a
 * pathological one (a year of capped 500-run days) degrades to re-reading
 * instead of pinning hundreds of megabytes for the life of the process.
 */
const USAGE_DAY_MEMO_BUDGET_BYTES = 16 * 1024 * 1024

/** Local calendar day key, `YYYY-MM-DD` (auto-analysis daily budget and the usage ledger share this). */
export function dayKey(now = Date.now()) {
  const date = new Date(now)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * `today`'s day key moved back `days` **calendar** days, anchored at local noon.
 * Subtracting a fixed `days * 86_400_000` instead would land a day early across
 * a spring-forward (a 23 h day), silently keeping one day more than asked for.
 */
function dayKeyBefore(today, days) {
  const match = USAGE_DAY_RE.exec(String(today))
  const at = match !== null
    ? new Date(Number(match[0].slice(0, 4)), Number(match[0].slice(5, 7)) - 1, Number(match[0].slice(8, 10)))
    : new Date(today)
  at.setHours(12, 0, 0, 0)
  at.setDate(at.getDate() - days)
  return dayKey(at.getTime())
}

function emptyUsageSummaryRaw() {
  return { version: 1, trackingSince: Date.now(), lifetime: {}, byType: {}, byModel: {}, days: {} }
}

export function emptyProfile() {
  return {
    analyzedCount: 0,
    patterns: [],
    updatedAt: 0,
    styleRules: [],
    feedbackLog: [],
    pendingDistill: 0,
    directives: [],
    analysesSinceDirectives: 0,
  }
}

export class CoachStore {
  constructor(root) {
    this.root = root
    /** Absolute paths already warned about (corrupt usage JSON) — warn once per file, not once per read. */
    this.warnedUsageFiles = new Set()
    /** Parsed day files by absolute path, keyed on the `mtimeMs`/`size` they were read at. */
    this.usageDayMemo = new Map()
    this.usageDayMemoBytes = 0
  }

  ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true })
  }

  readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return fallback
    }
  }

  writeJsonAtomic(file, value) {
    this.ensureDir(path.dirname(file))
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }

  /** Filesystem-safe session id (the browser id never reaches a path verbatim). */
  safeSessionId(sessionId) {
    const value = String(sessionId ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128)
    return value.length > 0 ? value : 'unknown'
  }

  configPatch() {
    const value = this.readJson(path.join(this.root, 'config.patch.json'), {})
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }

  saveConfigPatch(patch) {
    this.writeJsonAtomic(path.join(this.root, 'config.patch.json'), patch)
    return patch
  }

  profile() {
    const value = this.readJson(path.join(this.root, 'profile.json'), emptyProfile())
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { ...emptyProfile(), ...value }
      : emptyProfile()
  }

  saveProfile(profile) {
    this.writeJsonAtomic(path.join(this.root, 'profile.json'), profile)
  }

  /** {date: 'YYYY-MM-DD', count} of automatic analyses spent today. */
  autoLedger(date) {
    const value = this.readJson(path.join(this.root, 'auto.json'), null)
    if (value !== null && typeof value === 'object' && value.date === date && typeof value.count === 'number') {
      return { date, count: Math.max(0, Math.round(value.count)) }
    }
    return { date, count: 0 }
  }

  bumpAuto(date) {
    const ledger = this.autoLedger(date)
    const next = { date, count: ledger.count + 1 }
    this.writeJsonAtomic(path.join(this.root, 'auto.json'), next)
    return next
  }

  reportFile(sessionId, turn) {
    return path.join(this.root, 'reports', this.safeSessionId(sessionId), `${turn}.json`)
  }

  report(sessionId, turn) {
    const value = this.readJson(this.reportFile(sessionId, turn), null)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  }

  saveReport(sessionId, turn, report) {
    this.writeJsonAtomic(this.reportFile(sessionId, turn), report)
  }

  /**
   * Latest analysis reports across EVERY session (for the settings/sidebar
   * panel), newest first, capped at `limit`. Only the plugin's own
   * /^\d+\.json$/ files are read.
   */
  listAllReports(limit = 50) {
    const root = path.join(this.root, 'reports')
    let sessionDirs = []
    try {
      sessionDirs = fs.readdirSync(root)
    } catch {
      return []
    }
    const entries = []
    for (const name of sessionDirs) {
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(name)) continue
      const sessionDir = path.join(root, name)
      let files = []
      try {
        files = fs.readdirSync(sessionDir)
      } catch {
        continue
      }
      for (const file of files) {
        const match = /^(\d+)\.json$/.exec(file)
        if (match === null) continue
        const report = this.readJson(path.join(sessionDir, file), null)
        if (report === null || typeof report !== 'object' || Array.isArray(report)) continue
        entries.push({
          sessionId: name,
          turn: Number(match[1]),
          time: typeof report.time === 'number' ? report.time : 0,
          model: typeof report.model === 'string' ? report.model : '',
          promptExcerpt: typeof report.promptExcerpt === 'string' ? report.promptExcerpt : '',
          improvedPrompt: typeof report.improvedPrompt === 'string' ? report.improvedPrompt : '',
          trigger: typeof report.trigger === 'string' ? report.trigger : 'manual',
          cwd: typeof report.cwd === 'string' ? report.cwd : '',
        })
      }
    }
    entries.sort((a, b) => b.time - a.time)
    return entries.slice(0, Math.max(0, Math.min(500, Math.floor(Number(limit) || 50))))
  }

  listReports(sessionId) {
    const dir = path.join(this.root, 'reports', this.safeSessionId(sessionId))
    let names = []
    try {
      names = fs.readdirSync(dir)
    } catch {
      return []
    }
    const out = []
    for (const name of names) {
      const match = /^(\d+)\.json$/.exec(name)
      if (match === null) continue
      const report = this.readJson(path.join(dir, name), null)
      if (report !== null && typeof report === 'object' && !Array.isArray(report)) {
        out.push({ turn: Number(match[1]), report })
      }
    }
    return out
  }

  /**
   * Remove only plugin-created report files (strict /^\d+\.json$/ naming)
   * inside the plugin's own reports directory; the per-session directory is
   * removed only when empty. Returns the number of files removed.
   */
  clearReports() {
    const root = path.join(this.root, 'reports')
    let removed = 0
    let sessionDirs = []
    try {
      sessionDirs = fs.readdirSync(root)
    } catch {
      return 0
    }
    for (const name of sessionDirs) {
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(name)) continue
      const sessionDir = path.join(root, name)
      let files = []
      try {
        files = fs.readdirSync(sessionDir)
      } catch {
        continue
      }
      for (const file of files) {
        if (!/^\d+\.json$/.test(file)) continue
        try {
          fs.unlinkSync(path.join(sessionDir, file))
          removed += 1
        } catch {
          // Keep going: one unreadable file must not block the rest.
        }
      }
      try {
        fs.rmdirSync(sessionDir)
      } catch {
        // Only removed when empty; any leftover means the directory stays.
      }
    }
    return removed
  }

  /** Warn once (not once per read) about one corrupt usage JSON file. */
  warnCorruptUsageFile(file) {
    if (this.warnedUsageFiles.has(file)) return
    this.warnedUsageFiles.add(file)
    console.warn(`[tacit] corrupt usage file, using defaults: ${file}`)
  }

  /** Read+parse a usage JSON file. Distinguishes "absent" (silent) from "corrupt" (warn once) from `readJson`, which cannot. */
  readUsageJson(file, schema, fallback) {
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch {
      return fallback // file simply doesn't exist yet — not corrupt
    }
    let value
    try {
      value = JSON.parse(raw)
    } catch {
      this.warnCorruptUsageFile(file)
      return fallback
    }
    const parsed = schema.safeParse(value)
    if (parsed.success) return parsed.data
    this.warnCorruptUsageFile(file)
    return fallback
  }

  usageDir() {
    return path.join(this.root, 'usage')
  }

  usageSummaryFile() {
    return path.join(this.usageDir(), 'summary.json')
  }

  /** `<usageDir>/<day>.json`; throws on anything but a strict YYYY-MM-DD day (never touches the filesystem with a bad path). */
  usageDayFile(day) {
    if (!USAGE_DAY_RE.test(day)) throw new Error(`invalid usage day: ${JSON.stringify(day)}`)
    return path.join(this.usageDir(), `${day}.json`)
  }

  /**
   * A parsed day file. Old day files never change, and `report()` re-reads the
   * whole window on every poll of the cost panel, so an unchanged file is
   * served from memory. The returned object is shared, not cloned: no caller
   * mutates it (`upsertDay` copies `runs` before editing).
   */
  readUsageDay(day) {
    const file = this.usageDayFile(day)
    let stat = null
    try {
      stat = fs.statSync(file)
    } catch {
      stat = null
    }
    if (stat === null) {
      this.forgetUsageDay(file)
      return this.readUsageJson(file, usageDayFileSchema, { version: 1, day, runs: [] })
    }
    const memo = this.usageDayMemo.get(file)
    if (memo !== undefined && memo.mtimeMs === stat.mtimeMs && memo.size === stat.size) return memo.value
    const value = this.readUsageJson(file, usageDayFileSchema, { version: 1, day, runs: [] })
    this.forgetUsageDay(file)
    this.usageDayMemo.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value })
    this.usageDayMemoBytes += stat.size
    while (this.usageDayMemoBytes > USAGE_DAY_MEMO_BUDGET_BYTES) {
      const oldest = this.usageDayMemo.keys().next()
      if (oldest.done) break
      this.forgetUsageDay(oldest.value)
    }
    return value
  }

  /**
   * Drop one memoized day file. Every in-process write and unlink calls this:
   * a same-millisecond same-size rewrite would otherwise pass the stat check
   * and let `upsertDay`'s read-modify-write silently drop runs.
   */
  forgetUsageDay(file) {
    const memo = this.usageDayMemo.get(file)
    if (memo === undefined) return
    this.usageDayMemo.delete(file)
    this.usageDayMemoBytes -= memo.size
  }

  /** Atomic write; caps `runs` to the newest 500 by `startedAt` before writing. */
  writeUsageDay(day, file) {
    const runs = Array.isArray(file?.runs) ? [...file.runs] : []
    runs.sort((a, b) => (Number(a?.startedAt) || 0) - (Number(b?.startedAt) || 0))
    this.forgetUsageDay(this.usageDayFile(day))
    this.writeJsonAtomic(this.usageDayFile(day), { version: 1, day, runs: runs.slice(-500) })
  }

  /**
   * Ascending day keys (`YYYY-MM-DD`, chronological under plain string sort)
   * for every file matching the plugin's own usage-day naming — atomic-write
   * temp files (`<file>.tmp-<pid>-<ts>`), `summary.json`, and anything else
   * are ignored. `[]` when `usage/` doesn't exist yet.
   */
  listUsageDays() {
    let names = []
    try {
      names = fs.readdirSync(this.usageDir())
    } catch {
      return []
    }
    return names
      .filter((name) => USAGE_DAY_FILE_RE.test(name))
      .map((name) => name.slice(0, -'.json'.length))
      .sort()
  }

  readUsageSummary() {
    return this.readUsageJson(this.usageSummaryFile(), usageSummarySchema, usageSummarySchema.parse(emptyUsageSummaryRaw()))
  }

  writeUsageSummary(summary) {
    this.writeJsonAtomic(this.usageSummaryFile(), summary)
  }

  /**
   * Remove day files older than `keepDays` relative to `today` (default:
   * today's own `dayKey()`), by plain string comparison of `YYYY-MM-DD`
   * (chronological for same-length zero-padded dates). Returns the count
   * removed; an unlink failure is swallowed per file, same as `clearReports`.
   */
  pruneUsageDays(keepDays, today = dayKey()) {
    const days = Math.max(0, Math.round(Number(keepDays) || 0))
    const cutoff = dayKeyBefore(today, days)
    let removed = 0
    for (const day of this.listUsageDays()) {
      if (day >= cutoff) continue
      try {
        this.forgetUsageDay(this.usageDayFile(day))
        fs.unlinkSync(this.usageDayFile(day))
        removed += 1
      } catch {
        // Keep going: one unreadable file must not block the rest.
      }
    }
    return removed
  }

  /**
   * Remove every plugin-named usage day file and start a fresh summary
   * (`trackingSince: Date.now()`). Never removes the `usage/` directory or
   * any file that doesn't match the plugin's own day-file naming.
   */
  clearUsage() {
    let removed = 0
    for (const day of this.listUsageDays()) {
      try {
        this.forgetUsageDay(this.usageDayFile(day))
        fs.unlinkSync(this.usageDayFile(day))
        removed += 1
      } catch {
        // Keep going: one unreadable file must not block the rest.
      }
    }
    this.writeUsageSummary(usageSummarySchema.parse({ ...emptyUsageSummaryRaw(), trackingSince: Date.now() }))
    return { removed }
  }
}
