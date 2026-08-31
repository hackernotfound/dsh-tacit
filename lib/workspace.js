import fs from 'node:fs'
import path from 'node:path'

/**
 * The identity of a workspace: the absolute directory with `..` resolved, a
 * trailing separator stripped and symlinks followed when it exists on disk.
 * Case is left alone. '' when there is no directory.
 */
export function normalizeWorkspace(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  const resolved = path.resolve(raw)
  try {
    return fs.realpathSync(resolved)
  } catch {
    return resolved
  }
}

/** Whether `cwd` is `scope` itself or a directory inside it — by path segment, never by string prefix. */
export function workspaceContains(scope, cwd) {
  if (typeof scope !== 'string' || scope.length === 0 || typeof cwd !== 'string') return false
  if (cwd === scope) return true
  const base = /[\\/]$/.test(scope) ? scope.slice(0, -1) : scope
  return cwd.startsWith(base + '/') || cwd.startsWith(base + '\\')
}

/** The last path segment of a workspace directory — what a person calls the project. */
export function workspaceLabel(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return ''
  const parts = cwd.split(/[\\/]+/).filter((part) => part.length > 0)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/**
 * A distinct label per workspace, in insertion order: the basename, extended by
 * one more parent segment at a time (`a/web`, `b/web`) while two of them would
 * read the same, up to the full path.
 */
export function workspaceLabels(cwds) {
  const distinct = [...new Set((Array.isArray(cwds) ? cwds : []).filter((cwd) => typeof cwd === 'string' && cwd.length > 0))]
  const segments = new Map(distinct.map((cwd) => [cwd, cwd.split(/[\\/]+/).filter((part) => part.length > 0)]))
  const depth = new Map(distinct.map((cwd) => [cwd, 1]))
  const labelOf = (cwd) => segments.get(cwd).slice(-depth.get(cwd)).join('/')
  for (;;) {
    const groups = new Map()
    for (const cwd of distinct) {
      const label = labelOf(cwd)
      if (groups.has(label)) groups.get(label).push(cwd)
      else groups.set(label, [cwd])
    }
    let grew = false
    for (const group of groups.values()) {
      if (group.length < 2) continue
      for (const cwd of group) {
        if (depth.get(cwd) >= segments.get(cwd).length) continue
        depth.set(cwd, depth.get(cwd) + 1)
        grew = true
      }
    }
    if (!grew) return new Map(distinct.map((cwd) => [cwd, labelOf(cwd)]))
  }
}
