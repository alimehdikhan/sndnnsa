// The static build's data: copy the committed snapshot (backend/data/snapshot.json, the
// body of GET /api/dataset) next to the app, where `npm run build:static` points the UI.
import { copyFileSync, statSync } from 'node:fs'

const from = new URL('../../backend/data/snapshot.json', import.meta.url)
const to = new URL('../dist/snapshot.json', import.meta.url)
copyFileSync(from, to)
console.log(`dist/snapshot.json (${(statSync(to).size / 1024).toFixed(0)} KB)`)
