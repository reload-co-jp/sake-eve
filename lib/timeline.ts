import { jstDate } from "./event"
import type { Event } from "./types"

export type Scale = "day" | "week" | "month"

export const SCALES: Record<
  Scale,
  { label: string; days: number; px: number }
> = {
  day: { label: "日", days: 14, px: 72 },
  week: { label: "週", days: 12 * 7, px: 14 },
  month: { label: "月", days: 365, px: 4 },
}

const DAY = 86_400_000
/** Day number of a YYYY-MM-DD date (calendar arithmetic, timezone-free). */
const dayNum = (ymd: string) =>
  Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / DAY
const fromDayNum = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
export const addDays = (ymd: string, n: number) => fromDayNum(dayNum(ymd) + n)

const WEEKDAYS = "日月火水木金土"
const md = (ymd: string) => `${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}`

/** Snap the window start to the scale's natural boundary (Monday / 1st of month). */
export const alignStart = (ymd: string, scale: Scale) => {
  if (scale === "month") return `${ymd.slice(0, 8)}01`
  if (scale === "week") {
    const dow = new Date(dayNum(ymd) * DAY).getUTCDay()
    return addDays(ymd, -((dow + 6) % 7))
  }
  return ymd
}

/** Shift by one window (months move by calendar months). */
export const shiftWindow = (start: string, scale: Scale, dir: 1 | -1) => {
  if (scale !== "month") return addDays(start, dir * SCALES[scale].days)
  const d = new Date(`${start}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + dir * 12)
  return d.toISOString().slice(0, 10)
}

export const buildTimeline = (events: Event[], scale: Scale, start: string) => {
  const { days } = SCALES[scale]
  const first = dayNum(start)
  const end = addDays(start, days - 1)

  const ticks: { offset: number; label: string }[] = []
  for (let i = 0; i < days; i++) {
    const d = fromDayNum(first + i)
    const dow = new Date((first + i) * DAY).getUTCDay()
    if (scale === "day")
      ticks.push({ offset: i, label: `${md(d)}(${WEEKDAYS[dow]})` })
    else if (scale === "week" && dow === 1)
      ticks.push({ offset: i, label: `${md(d)}〜` })
    else if (scale === "month" && d.endsWith("-01"))
      ticks.push({ offset: i, label: `${d.slice(0, 4)}年${+d.slice(5, 7)}月` })
  }

  // Events without dates are not shown on the timeline.
  const bars = events.flatMap((e) => {
    if (!e.startAt) return []
    const s = jstDate(e.startAt)
    const t = jstDate(e.endAt ?? e.startAt)
    if (t < start || s > end) return []
    const from = Math.max(dayNum(s), first) - first
    const to = Math.min(dayNum(t), first + days - 1) - first
    return [
      {
        event: e,
        offset: from,
        span: to - from + 1,
        continuesBefore: s < start,
        continuesAfter: t > end,
      },
    ]
  })
  return { days, end, ticks, bars }
}
