import path from 'node:path'
import { defineConfig } from 'vitest/config'

// `npm test`: engine unit and fixture-parity tests. `npm run parity`: the same engine
// against a running API's real data (make serve first).
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/**/*.test.ts'] } },
      { extends: true, test: { name: 'parity', include: ['tests/**/*.live.ts'], testTimeout: 120_000 } },
    ],
  },
})
