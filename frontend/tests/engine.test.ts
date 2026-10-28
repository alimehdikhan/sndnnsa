import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { AccuracyView, DecisionView, Gate } from '@/lib/api'
import { Engine, type DatasetSnapshot } from '@/lib/engine'
import { expectSameAnswer } from './compare'

// The backend's answers on synthetic snapshots (backend/scripts/export_engine_fixture.py):
// "january" is the API tests' dataset, "dst" spans the clocks going forward on 29 March.
interface Answers {
  snapshot: DatasetSnapshot
  decision: Record<string, DecisionView>
  accuracy: Record<`gate|${Gate}`, AccuracyView> & { horizon: Omit<AccuracyView, 'selections'> & { selections: Record<string, AccuracyView['selections'][number]> } }
}
const fixture: Record<string, Answers> = JSON.parse(readFileSync(new URL('./fixtures/engine.json', import.meta.url), 'utf8'))

describe.each(Object.entries(fixture))('%s snapshot', (_, answers) => {
  const engine = new Engine(answers.snapshot)

  test('delivery days match the backend', () => {
    const days = [...new Set(Object.keys(answers.decision).map((k) => k.split('|')[0]))]
    expect(engine.days()).toEqual(days)
  })

  test.each(Object.keys(answers.decision))('Decision view %s', (key) => {
    const [day, gate] = key.split('|') as [string, Gate]
    expectSameAnswer(engine.decision(day, gate), answers.decision[key])
  })

  test.each(['09:20', '09:50', '15:30'] as const)('Accuracy view, gate %s', (gate) => {
    const expected = answers.accuracy[`gate|${gate}`]
    expectSameAnswer(engine.byHorizon(), expected.byHorizon)
    expectSameAnswer(engine.accuracy({ mode: 'gate', gate }), expected.selections[0])
  })

  test('Accuracy view, horizons', () => {
    const expected = answers.accuracy.horizon
    for (const [h, selection] of Object.entries(expected.selections)) {
      expectSameAnswer(engine.accuracy({ mode: 'horizon', h: Number(h) }), selection, `h=${h}`)
    }
  })

  test('answers are computed once and reused', () => {
    const [day, gate] = Object.keys(answers.decision)[0].split('|') as [string, Gate]
    expect(engine.decision(day, gate)).toBe(engine.decision(day, gate))
    expect(engine.accuracy({ mode: 'horizon', h: 12 })).toBe(engine.accuracy({ mode: 'horizon', h: 12 }))
  })
})
