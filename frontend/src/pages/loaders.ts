// Page chunks, loaded on demand (React.lazy) and prefetched when the browser is idle.
export const loadDecisionPage = () => import('@/pages/decision-view').then((m) => ({ default: m.DecisionView }))
export const loadAccuracyPage = () => import('@/pages/accuracy-view').then((m) => ({ default: m.AccuracyView }))
