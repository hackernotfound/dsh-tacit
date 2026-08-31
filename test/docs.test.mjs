// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseNotes } from '../scripts/release-notes.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('the Known limitations list describes Tacit as it is, without pinning itself to a release', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/privacy-and-cost.md'), 'utf8')
  const start = doc.indexOf('## Known limitations')
  assert.ok(start > 0, 'the section exists')
  const firstBullet = doc.indexOf('\n- ', start)
  assert.ok(firstBullet > start, 'the list under it exists')
  const intro = doc.slice(start, firstBullet)
  assert.equal(/v\d+\.\d+/.test(intro), false, 'a version number here goes stale the next release')
})

const changelog = () => fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')

test('the packaged version has a released changelog section, and it is what the GitHub release will say', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const notes = releaseNotes(changelog(), version)
  assert.ok(/^### (Upgrading|Added|Changed|Fixed|Security|Removed)$/m.test(notes), 'grouped under Keep a Changelog headings')
  assert.ok(notes.includes('**Full diff**: https://github.com/hackernotfound/dsh-tacit/compare/'), 'ends with the compare link')
  assert.ok(!notes.includes('## ['), 'stops before the next version')
})

test('release notes refuse an unreleased or unknown version', () => {
  assert.throws(() => releaseNotes(changelog(), 'Unreleased'), /no released section/)
  assert.throws(() => releaseNotes(changelog(), '9.9.9'), /no released section/)
  assert.throws(() => releaseNotes('## [1.0.0] - 2026-01-01\n\nNothing yet.\n', '1.0.0'), /empty/)
})

test('every released version in the changelog has a compare link, and an Unreleased section is waiting', () => {
  const doc = changelog()
  let released = 0
  for (const [, version] of doc.matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}$/gm)) {
    released += 1
    assert.ok(doc.includes('\n[' + version + ']: https://'), version + ' has a link reference')
  }
  assert.ok(released >= 7)
  assert.ok(/^## \[Unreleased\]$/m.test(doc))
})
