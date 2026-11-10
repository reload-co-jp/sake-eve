import Link from "next/link"
import { FC } from "react"
import { EventList } from "@/components/EventCard"
import { byStartAt, effectiveStatus, formatPeriod } from "@/lib/event"
import type { Event } from "@/lib/types"

/**
 * Server-rendered content for the search views' Suspense fallback.
 * useSearchParams() makes static export bail out to the fallback, so without
 * this the prerendered HTML holds only a loading message and crawlers see an
 * empty page. The client view replaces it once the query is read.
 */
export const EventsFallback: FC<{
  events: Event[]
  variant?: "cards" | "list"
}> = ({ events, variant = "cards" }) => {
  const upcoming = events
    .filter((e) => effectiveStatus(e) !== "ended")
    .sort(byStartAt)
  return (
    <>
      <h2>開催予定・開催中のイベント {upcoming.length}件</h2>
      {variant === "cards" ? (
        <EventList events={upcoming} />
      ) : (
        <ul className="compact-list">
          {upcoming.map((e) => (
            <li key={e.id}>
              <Link href={`/events/${e.slug}/`}>{e.title}</Link>
              <span>
                {formatPeriod(e)}
                {e.venue.prefecture && ` ／ ${e.venue.prefecture}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
