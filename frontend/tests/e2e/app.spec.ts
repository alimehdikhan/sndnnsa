import { expect, test, type Page } from '@playwright/test'

// The interaction guarantees the app makes: one data request, instant controls,
// shortcuts, URL state, synced crosshairs, no skeletons after load, no console errors.

const dayButton = (page: Page) => page.getByRole('button', { name: /^Delivery day/ })
const gateOn = (page: Page) => page.locator('[aria-label="Gate · day before, UK"] [data-state="on"]')
const kpiReadouts = (page: Page) => page.locator('main section [aria-live="polite"]').filter({ hasText: /\d\d:00/ })

/** Fails the test on any console error or warning, or uncaught exception. */
function watchConsole(page: Page): string[] {
  const problems: string[] = []
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`))
  return problems
}

async function openDecision(page: Page, day = '2026-01-12', gate = '09:20') {
  await page.goto(`/decision?day=${day}&gate=${gate}`)
  await expect(page.getByRole('heading', { name: 'Day summary' })).toBeVisible()
  await expect(page.locator('.skeleton')).toHaveCount(0)
}

test('loads the snapshot once; no interaction touches the network', async ({ page }) => {
  const problems = watchConsole(page)
  const requests: string[] = []
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname
    if (path.startsWith('/api/') && path !== '/api/health') requests.push(path)
  })

  await openDecision(page)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('2')
  await page.keyboard.press('a')
  await expect(page.getByRole('heading', { name: 'Accuracy view', level: 1 })).toBeVisible()
  await page.keyboard.press('h')
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/mode=horizon&h=25/)

  expect(requests).toEqual(['/api/dataset'])
  expect(problems).toEqual([])
})

test('keyboard shortcuts step days and gates, and the URL follows', async ({ page }) => {
  await openDecision(page)

  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/day=2026-01-13/)
  await expect(dayButton(page)).toContainText('13 Jan 2026')

  await page.keyboard.press('Shift+ArrowLeft')
  await expect(page).toHaveURL(/day=2026-01-06/)

  await page.keyboard.press('3')
  await expect(gateOn(page)).toHaveText('15:30')
  await expect(page).toHaveURL(/gate=15%3A30/)

  await page.keyboard.press('Home')
  await expect(page).toHaveURL(/day=2026-01-02/)
  await page.keyboard.press('End')
  await expect(page).toHaveURL(/day=2026-02-01/) // the last delivery day decided in January
})

test('out-of-range days in the URL snap to the snapshot', async ({ page }) => {
  await page.goto('/decision?day=2025-06-01&gate=09:50')
  await expect(page).toHaveURL(/day=2026-01-02&gate=09%3A50/)
  await page.goto('/decision')
  await expect(page).toHaveURL(/day=2026-01-02/)
})

test('Back and Forward restore the exact view', async ({ page }) => {
  await openDecision(page, '2026-01-20', '09:50')
  await page.keyboard.press('a')
  await expect(page).toHaveURL(/\/accuracy/)
  await page.keyboard.press('h')
  await expect(page).toHaveURL(/mode=horizon/)

  await page.goBack()
  await expect(page).toHaveURL(/\/decision\?day=2026-01-20&gate=09%3A50/)
  await expect(dayButton(page)).toContainText('20 Jan 2026')
  await expect(gateOn(page)).toHaveText('09:50')

  await page.goForward()
  await expect(page).toHaveURL(/\/accuracy\?mode=horizon/)
})

test('the Decision chart and its error strip share one crosshair', async ({ page }) => {
  await openDecision(page)
  const plot = page.locator('main section .recharts-surface').first()
  const box = (await plot.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5)

  await expect(page.locator('main section .recharts-tooltip-cursor')).toHaveCount(2)
  await expect(page.getByText(/Mon 12 Jan · \d\d:\d\d GMT/)).toBeVisible()
})

test('hovering the hour chart highlights the same hour in every KPI sparkline', async ({ page }) => {
  await page.goto('/accuracy?mode=gate&gate=09:20')
  const hourCard = page.locator('main section').filter({ has: page.getByRole('heading', { name: 'Error by hour of day' }) })
  const box = (await hourCard.locator('.recharts-surface').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.6)

  const readouts = await kpiReadouts(page).allTextContents()
  expect(readouts).toHaveLength(3)
  const hours = new Set(readouts.map((t) => t.slice(0, 5)))
  expect(hours.size).toBe(1) // all three KPIs show the hovered hour
})

test('the shortcuts sheet opens with ? and closes with Escape', async ({ page }) => {
  await openDecision(page)
  await page.keyboard.press('Shift+?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('the day stepper acts on press and repeats while held', async ({ page }) => {
  await openDecision(page)
  const next = page.getByRole('button', { name: 'Next day' })
  const box = (await next.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

  const dayOfMonth = () => Number(new URL(page.url()).searchParams.get('day')?.slice(8))
  await page.mouse.down()
  // Acts on press: the day has moved while the button is still held down.
  await page.waitForURL((url) => url.searchParams.get('day') !== '2026-01-12')
  await page.waitForTimeout(700) // held: it keeps stepping after a short pause
  await page.mouse.up()
  const afterHold = page.url()
  expect(afterHold).not.toMatch(/day=2026-01-1[23]&/)
  expect(dayOfMonth() > 14 || afterHold.includes('day=2026-02')).toBe(true)
})
