// Performance budget: fail the build when the initial JS (the entry script plus
// everything index.html modulepreloads) exceeds the budget, gzipped.
// Usage: node scripts/check-bundle-size.mjs [--budget-kb 180]
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist'
const flag = process.argv.indexOf('--budget-kb')
const BUDGET_KB = flag > -1 ? Number(process.argv[flag + 1]) : 180

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
const initial = new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))
const gz = (file) => gzipSync(readFileSync(join(DIST, file)), { level: 9 }).length
const kb = (bytes) => (bytes / 1024).toFixed(1).padStart(7)

let initialJs = 0
let initialCss = 0
const rows = []
for (const name of readdirSync(join(DIST, 'assets')).filter((f) => /\.(js|css)$/.test(f))) {
  const file = `assets/${name}`
  const size = gz(file)
  const isInitial = initial.has(file)
  if (isInitial && name.endsWith('.js')) initialJs += size
  if (isInitial && name.endsWith('.css')) initialCss += size
  rows.push({ name, size, isInitial })
}
rows.sort((a, b) => b.size - a.size)
for (const r of rows) console.log(`${r.isInitial ? 'initial' : 'lazy   '} ${kb(r.size)} KB  ${r.name}`)
console.log(`\nInitial JS ${kb(initialJs)} KB gzipped (budget ${BUDGET_KB} KB) · initial CSS ${kb(initialCss)} KB`)

if (initialJs > BUDGET_KB * 1024) {
  console.error(`Initial JS is over budget by ${((initialJs - BUDGET_KB * 1024) / 1024).toFixed(1)} KB`)
  process.exit(1)
}
