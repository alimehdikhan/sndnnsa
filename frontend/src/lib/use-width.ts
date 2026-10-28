import { useLayoutEffect, useState } from 'react'

/**
 * Width of the card body. Charts get this exact pixel size rather than measuring
 * themselves, so they always follow the card when the window or sidebar changes.
 */
export function useWidth(el: HTMLElement | null): number {
  const [width, setWidth] = useState(0)
  // Layout effect: the first measurement lands before paint, so width-sized charts never jump.
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [el])
  return width
}
