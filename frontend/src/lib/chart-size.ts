import { createContext, useContext } from 'react'

/** The pixel size of a ChartCard's body, for charts that lay out more than one plot. */
export const ChartSize = createContext({ width: 0, height: 0 })

export function useChartSize(): { width: number; height: number } {
  return useContext(ChartSize)
}
