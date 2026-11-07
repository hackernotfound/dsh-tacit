import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const assets = path.join(root, 'docs/assets')
const xml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const text = (x, y, value, size = 24, fill = '#172033', weight = 400) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${xml(value)}</text>`
const box = (x, y, width, height, fill = '#fff', stroke = '#dbe3ef', radius = 16) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`
const button = (x, y, width, label, primary = false) => box(x, y, width, 44, primary ? '#246bdb' : '#fff', primary ? '#246bdb' : '#cdd8e8', 9)
  + text(x + 17, y + 29, label, 20, primary ? '#fff' : '#344861', 600)
const panel = (number, label, title, content, footer) => `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#f7f9fc"/><stop offset="1" stop-color="#eaf1fb"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <g font-family="Helvetica, Arial, sans-serif">
    ${text(96, 72, 'Tacit', 30, '#246bdb', 700)}
    ${text(173, 72, 'for DeepSeek Harness', 30, '#172033', 700)}
    ${box(1044, 40, 140, 44, '#fff', '#dbe3ef', 22)}
    ${text(1073, 69, `v${version}`, 20, '#4b5d73', 600)}
    <circle cx="113" cy="133" r="17" fill="#246bdb"/>
    ${text(108, 139, number, 17, '#fff', 700)}
    ${text(145, 141, label, 21, '#246bdb', 700)}
    ${text(96, 211, title, 44, '#172033', 700)}
    ${content}
    ${text(96, 626, footer, 21, '#42566e')}
    ${text(96, 674, 'Illustrated walkthrough · example data', 17, '#61748c')}
    ${text(810, 674, 'github.com/hackernotfound/dsh-tacit', 17, '#61748c')}
  </g>
</svg>
`.replace(/[ \t]+\n/g, '\n')

const slides = [
  ['tacit-install.svg', panel('1', 'Install or update', 'Add Tacit in one command.', `
    ${box(96, 252, 1088, 310, '#111827', '#111827', 19)}
    <path d="M115 252h1050a19 19 0 0 1 19 19v30H96v-30a19 19 0 0 1 19-19z" fill="#1c293e"/>
    <circle cx="128" cy="277" r="6" fill="#ff8d86"/><circle cx="151" cy="277" r="6" fill="#ffd166"/><circle cx="174" cy="277" r="6" fill="#66dbad"/>
    <g font-family="Menlo, Consolas, monospace">
      ${text(126, 355, '$', 23, '#79b8ff')}
      ${text(158, 355, 'npx @deepseek-ai/dsh plugin --profile web add dsh-tacit', 23, '#e5edf8')}
      ${text(126, 408, 'dependencies:', 23, '#95a9c2')}
      ${text(126, 457, `+ dsh-tacit ${version}`, 24, '#80e3b3')}
      ${text(126, 518, 'Restart dsh web, then refresh the page.', 22, '#e5edf8')}
    </g>
    ${text(96, 594, 'Supports DSH 0.2. Current DSH needs Node 24.9 or newer.', 23, '#42566e')}
  `, 'Reports stay local. Analysis makes paid calls through your configured provider.')],
  ['tacit-learn.svg', panel('2', 'Learn from corrections', 'Turn a repeated correction into guidance.', `
    ${box(96, 253, 1088, 146)}
    ${text(124, 288, 'YOUR CORRECTION', 16, '#61748c', 700)}
    ${text(124, 333, '"No, I meant the Next.js app under apps/web."', 30, '#172033', 500)}
    ${text(124, 373, 'Tacit looks for patterns in retries, tool errors and corrections.', 23, '#53677f')}
    <path d="M640 411v29m-9-9 9 9 9-9" fill="none" stroke="#246bdb" stroke-width="3"/>
    ${box(96, 456, 1088, 119, '#edf4ff', '#a9c8f5')}
    ${text(124, 490, 'EXAMPLE LEARNED INSTRUCTION', 16, '#246bdb', 700)}
    ${text(124, 536, "Check apps/web first when I don't name an app.", 30, '#172033', 500)}
  `, 'New instructions start on trial. You can turn them off or delete them.')],
  ['tacit-guidance.svg', panel('3', 'Review your instructions', 'Edit what the agent is told.', `
    ${box(96, 251, 1088, 332)}
    ${text(122, 289, 'Settings / Tacit / Agent guidance', 23, '#172033', 700)}
    ${box(122, 311, 681, 46, '#f8fafc', '#dbe3ef', 8)}
    ${text(139, 341, 'Search text or workspace', 21, '#6b7e95')}
    ${box(820, 311, 338, 46, '#f8fafc', '#dbe3ef', 8)}
    ${text(838, 341, 'All statuses', 21, '#344861')}
    <path d="m1128 330 7 7 7-7" fill="none" stroke="#61748c" stroke-width="2"/>
    ${box(122, 377, 1036, 125, '#f8fbff', '#c7daf5', 10)}
    ${text(142, 407, 'active · yours · only apps/web', 18, '#246bdb', 600)}
    ${text(142, 450, "Check apps/web first when I don't name an app.", 27, '#172033', 500)}
    ${text(142, 483, 'Enabled', 19, '#53677f')}
    ${button(122, 519, 88, 'Edit', true)}
    ${button(222, 519, 136, 'Copy text')}
    ${button(370, 519, 112, 'Remove')}
    ${button(962, 519, 196, 'Copy guidance')}
  `, 'Editing keeps scope and enabled state, and clears the previous trial evidence.')],
].map(([name, svg]) => [name, svg.replace(/[\t ]+$/gm, '')])

const manifestFile = path.join(assets, 'tacit-demo.json')
const tracked = ['scripts/build-demo.mjs', ...slides.map(([name]) => `docs/assets/${name}`), 'docs/assets/tacit-demo.gif']
const manifest = async () => ({
  version,
  sha256: Object.fromEntries(await Promise.all(tracked.map(async (file) =>
    [file, createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')]))),
})

if (process.argv.includes('--check')) {
  const recorded = JSON.parse(await readFile(manifestFile, 'utf8'))
  if (JSON.stringify(recorded) !== JSON.stringify(await manifest())) {
    throw new Error('Demo assets are stale. Run node scripts/build-demo.mjs and commit all outputs.')
  }
  console.log(`Demo assets match version ${version} and their recorded source hashes`)
  process.exit(0)
}

for (const [name, svg] of slides) await writeFile(path.join(assets, name), svg)

const temporary = await mkdtemp(path.join(os.tmpdir(), 'tacit-demo-'))
try {
  for (const [index, [name]] of slides.entries()) {
    execFileSync('sips', ['-s', 'format', 'png', path.join(assets, name), '--out', path.join(temporary, `frame-${index}.png`)], { stdio: 'pipe' })
  }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '1/6', '-i', path.join(temporary, 'frame-%d.png'),
    '-filter_complex', '[0:v]scale=960:540:flags=lanczos,split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a',
    '-loop', '0', path.join(assets, 'tacit-demo.gif')], { stdio: 'pipe' })
} finally {
  await rm(temporary, { recursive: true, force: true })
}
await writeFile(manifestFile, JSON.stringify(await manifest(), null, 2) + '\n')
console.log(`Built illustrated Tacit ${version} walkthrough (${slides.length} panels)`)
