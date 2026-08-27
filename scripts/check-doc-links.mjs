import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const markdownFiles = [
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
]

async function collectMarkdown(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true })
  for (const entry of entries) {
    const relative = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) await collectMarkdown(relative)
    else if (entry.name.endsWith('.md')) markdownFiles.push(relative)
  }
}

await collectMarkdown('docs')

function githubSlug(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function headings(markdown) {
  const seen = new Map()
  const result = new Set()
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(?: {0,3})#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)
    if (!match) continue
    const base = githubSlug(match[1])
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    result.add(count === 0 ? base : `${base}-${count}`)
  }
  return result
}

function destinations(markdown) {
  const result = []
  const inline = /!?\[[^\]]*\]\(([^)\n]+)\)/g
  const html = /\bhref=["']([^"']+)["']/g
  for (const pattern of [inline, html]) {
    for (const match of markdown.matchAll(pattern)) {
      const raw = match[1].trim()
      const enclosed = /^<([^>]+)>/.exec(raw)
      result.push(enclosed ? enclosed[1] : raw.split(/\s+["']/)[0])
    }
  }
  return result
}

const markdownByFile = new Map()
for (const file of markdownFiles) {
  try {
    markdownByFile.set(file, await readFile(path.join(root, file), 'utf8'))
  } catch (error) {
    if (file === 'SECURITY.md' && error.code === 'ENOENT') continue
    throw error
  }
}

const errors = []
let checked = 0
for (const [source, markdown] of markdownByFile) {
  for (const destination of destinations(markdown)) {
    if (/^(?:mailto:|data:|javascript:)/i.test(destination)) continue

    let target = destination
    let fromRepositoryRoot = false
    if (/^https?:/i.test(target)) {
      const url = new URL(target)
      const prefix = '/hackernotfound/dsh-tacit/blob/main/'
      if (url.hostname !== 'github.com' || !url.pathname.startsWith(prefix)) continue
      target = `${decodeURIComponent(url.pathname.slice(prefix.length))}${url.hash}`
      fromRepositoryRoot = true
    }

    const [rawFile, rawFragment = ''] = target.split('#', 2)
    const targetFile = rawFile
      ? path.posix.normalize(path.posix.join(
          fromRepositoryRoot ? '' : path.posix.dirname(source),
          decodeURIComponent(rawFile),
        ))
      : source

    if (targetFile.startsWith('../') || path.isAbsolute(targetFile)) {
      errors.push(`${source}: link escapes the repository: ${destination}`)
      continue
    }

    try {
      await access(path.join(root, targetFile))
    } catch {
      errors.push(`${source}: missing target ${targetFile} (${destination})`)
      continue
    }

    if (rawFragment && targetFile.endsWith('.md')) {
      const targetMarkdown = markdownByFile.get(targetFile) ?? await readFile(path.join(root, targetFile), 'utf8')
      const fragment = decodeURIComponent(rawFragment).toLowerCase()
      if (!headings(targetMarkdown).has(fragment)) {
        errors.push(`${source}: missing anchor #${fragment} in ${targetFile}`)
        continue
      }
    }
    checked += 1
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`Checked ${checked} local documentation links across ${markdownByFile.size} Markdown files`)
