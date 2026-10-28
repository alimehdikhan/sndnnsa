import { expect, test } from 'vitest'
import type { AccuracyView, DecisionView } from '@/lib/api'
import { Engine, type DatasetSnapshot } from '@/lib/engine'
import { expectSameAnswer } from './compare'

// Every view the API serves for the real snapshot, recomputed by the engine.
// Run against a live server: make serve, then npm run parity (PARITY_URL to override).
const API = process.env.PARITY_URL ?? 'http://127.0.0.1:8000'
const get = async <T>(path: string): Promise<T> => (await (await fetch(`${API}${path}`)).json()) as T

test('engine reproduces every API view on the real data', async () => {
  const engine = new Engine(await get<DatasetSnapshot>('/api/dataset'))
  const days = engine.days()
  expect(days.length).toBeGreaterThan(0)

  for (const day of days) {
    for (const gate of ['09:20', '09:50', '15:30'] as const) {
      expectSameAnswer(engine.decision(day, gate), await get<DecisionView>(`/api/view/decision?day=${day}&gate=${gate}`), `${day} ${gate}`)
    }
  }
  for (const gate of ['09:20', '09:50', '15:30'] as const) {
    const view = await get<AccuracyView>(`/api/view/accuracy?mode=gate&gate=${gate}`)
    expectSameAnswer(engine.byHorizon(), view.byHorizon, 'byHorizon')
    expectSameAnswer(engine.accuracy({ mode: 'gate', gate }), view.selections[0], `gate ${gate}`)
  }
  const horizons = await get<AccuracyView>('/api/view/accuracy?mode=horizon')
  horizons.selections.forEach((selection, h) => expectSameAnswer(engine.accuracy({ mode: 'horizon', h }), selection, `h=${h}`))
})
