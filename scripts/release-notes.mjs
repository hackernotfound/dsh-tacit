// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * dsh-tacit — release notes from the changelog.
 *
 * `node scripts/release-notes.mjs 0.5.0` prints the `## [0.5.0]` section of
 * CHANGELOG.md followed by its compare link, so the GitHub release body and
 * the changelog are the same text. Exits non-zero when the section is missing
 * or empty, which is what keeps a tag from being released without notes.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The body of one version section plus its "Full diff" line; throws when there is nothing to publish. */
export function releaseNotes(markdown, version) {
  const start = markdown.search(new RegExp('^## \\[' + escape(version) + '\\] - \\d{4}-\\d{2}-\\d{2}$', 'm'))
  if (start < 0) throw new Error('CHANGELOG.md has no released section for ' + version)
  const afterHeading = markdown.indexOf('\n', start) + 1
  const next = markdown.slice(afterHeading).search(/^## /m)
  const body = (next < 0 ? markdown.slice(afterHeading) : markdown.slice(afterHeading, afterHeading + next)).trim()
  if (body.length === 0 || body === 'Nothing yet.') throw new Error('the ' + version + ' section of CHANGELOG.md is empty')
  const link = markdown.match(new RegExp('^\\[' + escape(version) + '\\]: (\\S+)$', 'm'))
  return body + (link === null ? '' : '\n\n**Full diff**: ' + link[1]) + '\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]
  if (typeof version !== 'string' || version.length === 0) {
    console.error('usage: node scripts/release-notes.mjs <version>')
    process.exit(2)
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  process.stdout.write(releaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version))
}
