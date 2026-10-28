import { lazy, Suspense, useEffect, useId, useRef, useState, type ComponentProps, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { CalendarBlankIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { dateFromDay, dayFromDate, shiftDay } from '@/lib/format'
import { cn } from '@/lib/utils'

const loadCalendar = () => import('@/components/ui/calendar').then((m) => ({ default: m.Calendar }))
const Calendar = lazy(loadCalendar)

function Field({ label, labelId, aside, children }: { label: string; labelId?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex h-[14px] items-baseline justify-between gap-3">
        <span className="label" id={labelId}>
          {label}
        </span>
        {aside}
      </div>
      {children}
    </div>
  )
}

export function IconButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'press grid size-8 place-items-center rounded-[8px] border border-border-strong bg-control text-fg-2 shadow-card hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40 disabled:hover:bg-control disabled:hover:text-fg-2',
        className,
      )}
      {...props}
    />
  )
}

/* ---------- Segmented control ---------- */

interface SegmentedProps<T extends string> {
  label: string
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (value: T) => void
}

export function Segmented<T extends string>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <Field label={label}>
      <ToggleGroup
        type="single"
        aria-label={label}
        value={value}
        onValueChange={(next) => next && onChange(next as T)}
        spacing={0}
        className="h-8 gap-0 rounded-[8px] bg-control-track p-[2px]"
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option.value}
            value={option.value}
            // Select on mouse-down, not release: the change lands while the button is still pressed.
            onPointerDown={(e) => {
              if (e.pointerType === 'mouse' && e.button === 0 && option.value !== value) onChange(option.value)
            }}
            className="press h-7 min-w-14 rounded-[6px]! px-3 text-13 font-medium text-fg-2 tabular-nums hover:bg-transparent hover:text-fg data-[state=on]:bg-control-thumb data-[state=on]:font-semibold data-[state=on]:text-fg data-[state=on]:shadow-thumb data-[state=on]:hover:bg-control-thumb"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  )
}

/* ---------- Date picker ---------- */

const pickerFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

interface DatePickerProps {
  label: string
  day: string
  min: string
  max: string
  /** `repeat` is true for steps fired by holding a button down. */
  onDay: (day: string, repeat?: boolean) => void
}

/**
 * Press handlers for a stepper button: acts on press rather than release, then repeats
 * while held (after a pause, like a key repeat). Keyboard activation acts once per press.
 */
function useStepper(step: (repeat: boolean) => void) {
  const latest = useRef(step)
  useEffect(() => {
    latest.current = step
  })
  const timer = useRef(0)
  const stop = () => window.clearTimeout(timer.current)
  useEffect(() => stop, [])
  return {
    onPointerDown(e: PointerEvent<HTMLButtonElement>) {
      if (e.button !== 0) return
      latest.current(false)
      const repeat = (delay: number) => {
        timer.current = window.setTimeout(() => {
          latest.current(true)
          repeat(70)
        }, delay)
      }
      stop()
      repeat(380)
      // The button may disable itself at the end of the range, so listen for release on the window.
      window.addEventListener('pointerup', stop, { once: true })
      window.addEventListener('pointercancel', stop, { once: true })
    },
    onPointerLeave: stop,
    onClick(e: MouseEvent<HTMLButtonElement>) {
      if (e.detail === 0) latest.current(false) // Enter or Space; pointer presses already acted
    },
  }
}

export function DatePicker({ label, day, min, max, onDay }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  const current = useRef(day)
  useEffect(() => {
    current.current = day
  }, [day])
  const shift = (n: number) => (repeat: boolean) => {
    const next = shiftDay(current.current, n)
    if (next < min || next > max) return
    current.current = next
    onDay(next, repeat)
  }
  const previous = useStepper(shift(-1))
  const following = useStepper(shift(1))
  // The calendar's code is a separate chunk; fetch it once the page is idle.
  useEffect(() => {
    const id = window.setTimeout(() => void loadCalendar(), 1500)
    return () => window.clearTimeout(id)
  }, [])
  return (
    <Field label={label} labelId={labelId}>
      <div className="flex items-center gap-1">
        <IconButton aria-label="Previous day" title="Previous day (←)" disabled={!day || day <= min} {...previous}>
          <CaretLeftIcon size={14} weight="bold" />
        </IconButton>
        <Popover
          open={open}
          onOpenChange={setOpen}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              // Name = label + visible date, so speech users can say what they see (WCAG 2.5.3).
              aria-labelledby={`${labelId} ${labelId}-value`}
              className="press inline-flex h-8 min-w-[164px] items-center gap-2 rounded-[8px] border border-border-strong bg-control px-2.5 text-13 font-medium text-fg shadow-card hover:bg-hover aria-expanded:border-teal"
            >
              <CalendarBlankIcon size={15} className="text-teal-text" />
              <span id={`${labelId}-value`} className="num">
                {day ? pickerFmt.format(new Date(`${day}T12:00:00Z`)) : 'Loading…'}
              </span>
              <CaretDownIcon size={12} weight="bold" className="ml-auto text-fg-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto rounded-[12px] border-0 bg-raised p-0 shadow-popover">
            <Suspense fallback={<div className="h-[300px] w-[252px]" />}>
            <Calendar
              mode="single"
              selected={dateFromDay(day)}
              onSelect={(date) => {
                if (date) onDay(dayFromDate(date))
                setOpen(false)
              }}
              defaultMonth={dateFromDay(day)}
              startMonth={dateFromDay(min)}
              endMonth={dateFromDay(max)}
              disabled={[{ before: dateFromDay(min) }, { after: dateFromDay(max) }]}
              weekStartsOn={1}
              autoFocus
              className="bg-transparent [&_.rdp-day_button]:font-mono [&_.rdp-day_button]:tabular-nums"
            />
            </Suspense>
          </PopoverContent>
        </Popover>
        <IconButton aria-label="Next day" title="Next day (→)" disabled={!day || day >= max} {...following}>
          <CaretRightIcon size={14} weight="bold" />
        </IconButton>
      </div>
    </Field>
  )
}

/* ---------- Slider ---------- */

interface ValueSliderProps {
  label: string
  value: number
  min: number
  max: number
  format: (value: number) => string
  describe: (value: number) => string
  onChange: (value: number) => void
}

/** Apple-style slider: the value sits in the label row, the track on the controls' 32px line. */
export function ValueSlider({ label, value, min, max, format, describe, onChange }: ValueSliderProps) {
  const labelId = useId()
  return (
    <Field
      label={label}
      labelId={labelId}
      aside={
        <span aria-hidden="true" className="num text-13 leading-[14px] font-semibold text-fg">
          {format(value)}
        </span>
      }
    >
      <SliderPrimitive.Root
        aria-labelledby={labelId}
        min={min}
        max={max}
        step={1}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        className="relative flex h-8 w-[220px] touch-none items-center select-none"
      >
        <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-control-track">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-teal" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-valuetext={describe(value)}
          className="block size-5 rounded-full bg-knob shadow-thumb ring-[0.5px] ring-border-strong transition-[transform,box-shadow] duration-150 ease-out hover:shadow-[var(--control-thumb-shadow),0_0_0_4px_var(--accent-subtle)] focus-visible:shadow-[var(--control-thumb-shadow),0_0_0_4px_var(--accent-subtle)] focus-visible:outline-none active:scale-110"
        />
      </SliderPrimitive.Root>
    </Field>
  )
}
