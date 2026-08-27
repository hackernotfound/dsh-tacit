/**
 * dsh-tacit — local storage (plugin-owned only).
 *
 * Everything lives under $DSH_HOME/storages/tacit/:
 *   config.patch.json            UI-written config fields (loader/YAML config is the base)
 *   profile.json                 persistent user mistake profile
 *   reports/<sessionId>/<turn>.json  analysis reports
 *
 * Safety rules (hard constraints):
 *  - writes are atomic (temp file + rename) and never truncate an existing
 *    file in place;
 *  - the ONLY deletion this plugin ever performs is `clearReports()`, which
 *    unlinks files matching /^\d+\.json$/ inside its own reports directory
 *    (then removes that directory only if empty) — nothing else on disk;
 *  - session ids are sanitized before touching the filesystem (no traversal).
 */

import fs from 'node:fs'
import path from 'node:path'

export function emptyProfile() {
  return {
    analyzedCount: 0,
    patterns: [],
    updatedAt: 0,
    styleRules: [],
    goodExamples: [],
    feedbackLog: [],
    pendingDistill: 0,
    directives: [],
    analysesSinceDirectives: 0,
  }
}

export class CoachStore {
  constructor(root) {
    this.root = root
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
          estimatedTokenSavingPct: typeof report.estimatedTokenSavingPct === 'number' ? report.estimatedTokenSavingPct : 0,
          trigger: typeof report.trigger === 'string' ? report.trigger : 'manual',
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
}
