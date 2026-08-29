// SPDX-License-Identifier: MIT
// Copyright (c) 2026 hackernotfound — https://github.com/hackernotfound/dsh-tacit
/**
 * Asserts, against a real DSH profile directory, that the installed Tacit
 * (1) imports, and (2) resolves the official @deepseek-ai packages to the
 * harness's own copies rather than to private copies nested under itself.
 *
 *   node scripts/check-install.mjs ~/.dsh/profiles/web
 */

import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const profile = process.argv[2]
if (!profile) {
  console.error('usage: node scripts/check-install.mjs <profile dir>')
  process.exit(2)
}
const linked = path.join(profile, 'node_modules', 'dsh-tacit')
if (!existsSync(linked)) {
  console.error(`dsh-tacit is not installed in ${profile}`)
  process.exit(1)
}
const plugin = realpathSync(linked)
const nested = path.join(plugin, 'node_modules', '@deepseek-ai')
if (existsSync(nested)) {
  console.error(`private @deepseek-ai copies are nested under the plugin: ${nested}`)
  process.exit(1)
}
const resolve = createRequire(path.join(plugin, 'lib', 'index.js'))
let failed = false
for (const name of ['@deepseek-ai/dsh-llm/message', '@deepseek-ai/dsh-home-paths']) {
  let resolved
  try {
    resolved = realpathSync(resolve.resolve(name))
  } catch (error) {
    console.error(`${name}: not resolvable from the installed plugin (${error.code ?? error.message})`)
    failed = true
    continue
  }
  if (resolved.startsWith(plugin + path.sep)) {
    console.error(`${name}: resolved to a private copy under the plugin: ${resolved}`)
    failed = true
  } else {
    console.log(`${name} -> ${resolved}`)
  }
}
try {
  const mod = await import(pathToFileURL(path.join(plugin, 'lib', 'index.js')).href)
  if (typeof mod.apply !== 'function') {
    console.error('dsh-tacit imported but exports no apply()')
    failed = true
  } else {
    console.log('dsh-tacit imports and exports apply()')
  }
} catch (error) {
  console.error(`dsh-tacit does not import from the installed location: ${error.code ?? error.message}`)
  failed = true
}
process.exit(failed ? 1 : 0)
