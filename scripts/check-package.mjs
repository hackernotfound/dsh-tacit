import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: root,
  encoding: 'utf8',
})
if (packed.status !== 0) {
  process.stderr.write(packed.stderr)
  process.exit(packed.status ?? 1)
}

const [manifest] = JSON.parse(packed.stdout)
const files = manifest.files.map(({ path: file }) => file).sort()
const required = [
  'LICENSE',
  'README.md',
  'client/client.js',
  'cordis.patch.yml',
  'lib/index.js',
  'package.json',
]
const allowedExact = new Set([
  'LICENSE',
  'README.md',
  'cordis.patch.yml',
  'docs/README.md',
  'docs/README.zh.md',
  'package.json',
])
const allowedPrefixes = ['client/', 'lib/']

const missing = required.filter((file) => !files.includes(file))
const unexpected = files.filter((file) => (
  !allowedExact.has(file) && !allowedPrefixes.some((prefix) => file.startsWith(prefix))
))
const sensitive = files.filter((file) => (
  /(^|\/)(?:\.env|credentials?|secrets?)(?:\.|$)/i.test(file)
  || /\.(?:key|pem|p12|keystore)$/i.test(file)
))

const readme = await readFile(path.join(root, 'README.md'), 'utf8')
if (!readme.includes('Learns what you leave unsaid in your prompts')) {
  missing.push('English root README content')
}

if (missing.length || unexpected.length || sensitive.length) {
  if (missing.length) console.error(`Missing package content: ${missing.join(', ')}`)
  if (unexpected.length) console.error(`Unexpected package content: ${unexpected.join(', ')}`)
  if (sensitive.length) console.error(`Sensitive-looking package content: ${sensitive.join(', ')}`)
  process.exit(1)
}

console.log(`Validated ${manifest.name}@${manifest.version}: ${files.length} packed files, ${manifest.unpackedSize} bytes`)
