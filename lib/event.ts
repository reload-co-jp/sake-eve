import {
  EVENT_STATUSES,
  EVENT_TYPES,
  GENRES,
  type Event,
  type EventStatus,
  type EventType,
  type Genre,
} from "./types"

const TZ = "Asia/Tokyo"
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ })

/** YYYY-MM-DD of the instant in Japan time. */
export const jstDate = (iso: string | Date) => ymd.format(new Date(iso))

/** Date-derived status, keeping editorial states (cancelled/postponed/unknown) as-is. */
export const effectiveStatus = (e: Event, now = new Date()): EventStatus => {
  if (e.status === "cancelled" || e.status === "postponed") return e.status
  if (!e.startAt) return "unknown"
  const t = now.getTime()
  const end = Date.parse(e.endAt ?? e.startAt)
  if (t > end) return "ended"
  if (t >= Date.parse(e.startAt)) return "ongoing"
  return "scheduled"
}

const dayFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ,
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
})
const timeFmt = new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
})

export const formatDateTime = (iso: string) =>
  `${dayFmt.format(new Date(iso))} ${timeFmt.format(new Date(iso))}`

export const formatPeriod = (
  e: Pick<Event, "startAt" | "endAt"> & { dateOnly?: boolean }
) => {
  if (!e.startAt) return "日程未定"
  const start = new Date(e.startAt)
  if (e.dateOnly) {
    const end = e.endAt ? new Date(e.endAt) : start
    return jstDate(start) === jstDate(end)
      ? dayFmt.format(start)
      : `${dayFmt.format(start)} 〜 ${dayFmt.format(end)}`
  }
  if (!e.endAt) return formatDateTime(e.startAt)
  const end = new Date(e.endAt)
  if (jstDate(start) === jstDate(end))
    return `${dayFmt.format(start)} ${timeFmt.format(start)}〜${timeFmt.format(end)}`
  return `${formatDateTime(e.startAt)} 〜 ${formatDateTime(e.endAt)}`
}

export type EventQuery = {
  q: string
  pref: string
  city: string
  from: string
  to: string
  genres: Genre[]
  types: EventType[]
  /** Empty = every status except "ended" (unless includeEnded). */
  statuses: EventStatus[]
  includeEnded: boolean
  freeOnly: boolean
  noReservationOnly: boolean
  sort: "start" | "new"
}

export const parseQuery = (p: URLSearchParams): EventQuery => ({
  q: p.get("q")?.trim() ?? "",
  pref: p.get("pref") ?? "",
  city: p.get("city")?.trim() ?? "",
  from: p.get("from") ?? "",
  to: p.get("to") ?? "",
  genres: p.getAll("genre").filter((g): g is Genre => g in GENRES),
  types: p.getAll("type").filter((t): t is EventType => t in EVENT_TYPES),
  statuses: p
    .getAll("status")
    .filter((s): s is EventStatus => s in EVENT_STATUSES),
  includeEnded: p.get("ended") === "1",
  freeOnly: p.get("free") === "1",
  noReservationOnly: p.get("noresv") === "1",
  sort: p.get("sort") === "new" ? "new" : "start",
})

const norm = (s: string) => s.normalize("NFKC").toLowerCase()

/**
 * @param extraText per-event searchable text that isn't on the event itself
 *   (e.g. names of participating producers and products).
 */
export const filterEvents = (
  events: Event[],
  q: EventQuery,
  now = new Date(),
  extraText: Record<string, string> = {}
): Event[] => {
  const words = norm(q.q).split(/\s+/).filter(Boolean)
  const city = norm(q.city)
  return events
    .filter((e) => {
      const status = effectiveStatus(e, now)
      if (q.statuses.length) {
        if (!q.statuses.includes(status)) return false
      } else if (!q.includeEnded && status === "ended") return false
      if (q.pref && e.venue.prefecture !== q.pref) return false
      if (city && !norm(e.venue.city ?? "").includes(city)) return false
      if (q.genres.length && !e.genres.some((g) => q.genres.includes(g)))
        return false
      if (q.types.length && !e.eventTypes.some((t) => q.types.includes(t)))
        return false
      // Unknown price/reservation (null) never matches these filters.
      if (q.freeOnly && e.isFree !== true) return false
      if (q.noReservationOnly && e.reservationRequired !== false) return false
      if (q.from || q.to) {
        // Period filter = overlap with [from, to] in JST dates; undated events never match.
        if (!e.startAt) return false
        const start = jstDate(e.startAt)
        const end = jstDate(e.endAt ?? e.startAt)
        if (q.to && start > q.to) return false
        if (q.from && end < q.from) return false
      }
      if (words.length) {
        const v = e.venue
        const hay = norm(
          [
            e.title,
            e.description,
            e.organizer,
            v.name,
            v.address,
            v.city,
            extraText[e.id],
          ]
            .filter(Boolean)
            .join(" ")
        )
        if (!words.every((w) => hay.includes(w))) return false
      }
      return true
    })
    .sort(q.sort === "new" ? byCreatedAtDesc : byStartAt)
}

export const byCreatedAtDesc = (a: Event, b: Event) =>
  Date.parse(b.createdAt) - Date.parse(a.createdAt)

/** Ascending by start date; undated events last. */
const startKey = (e: Event) =>
  e.startAt ? Date.parse(e.startAt) : Number.MAX_SAFE_INTEGER
export const byStartAt = (a: Event, b: Event) => startKey(a) - startKey(b)

/** Map marker data; null when the venue has no coordinates (such events are not mapped). */
export const toMapPoint = (e: Event) => {
  const { latitude, longitude, prefecture, city, name } = e.venue
  if (latitude === null || longitude === null) return null
  return {
    id: e.id,
    href: `/events/${e.slug}/`,
    title: e.title,
    period: formatPeriod(e),
    place: [prefecture, city, name].filter(Boolean).join(" ") || "会場未定",
    genres: e.genres.map((g) => GENRES[g]).join("・"),
    latitude,
    longitude,
  }
}
