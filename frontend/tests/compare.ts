import { expect } from 'vitest'

/**
 * Deep equality where numbers may differ by float summation order (numpy sums
 * pairwise, the engine sums left to right): relative tolerance 1e-9.
 */
export function expectSameAnswer(actual: unknown, expected: unknown, path = '$'): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const scale = Math.max(1, Math.abs(expected))
    if (Math.abs(actual - expected) > 1e-9 * scale) expect.fail(`${path}: ${actual} !== ${expected}`)
    return
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) expect.fail(`${path}: expected an array`)
    if (actual.length !== expected.length) expect.fail(`${path}: length ${actual.length} !== ${expected.length}`)
    expected.forEach((e, i) => expectSameAnswer(actual[i], e, `${path}[${i}]`))
    return
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') expect.fail(`${path}: expected an object, got ${JSON.stringify(actual)}`)
    const a = actual as Record<string, unknown>
    const e = expected as Record<string, unknown>
    const keys = new Set([...Object.keys(a), ...Object.keys(e)])
    for (const k of keys) expectSameAnswer(a[k], e[k], `${path}.${k}`)
    return
  }
  if (actual !== expected) expect.fail(`${path}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`)
}
