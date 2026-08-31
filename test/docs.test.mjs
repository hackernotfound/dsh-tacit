// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
