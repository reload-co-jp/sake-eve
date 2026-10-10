import Link from "next/link"
import { FC } from "react"
import { EventList } from "@/components/EventCard"
import { byStartAt, effectiveStatus } from "@/lib/event"
import type { Event } from "@/lib/types"

/** Upcoming events plus an archive of ended ones (ended events are kept, never deleted). */
export const EventArchive: FC<{ events: Event[]; searchHref: string }> = ({
  events,
  searchHref,
}) => {
  const ended = events.filter((e) => effectiveStatus(e) === "ended")
  const upcoming = events
    .filter((e) => effectiveStatus(e) !== "ended")
    .sort(byStartAt)
  return (
    <>
      <section aria-labelledby="upcoming">
        <h2 id="upcoming">開催予定・開催中のイベント（{upcoming.length}件）</h2>
        {upcoming.length ? (
          <EventList events={upcoming} />
        ) : (
          <p>現在掲載中の開催予定イベントはありません。</p>
        )}
        <p className="more">
          <Link href={searchHref}>条件を追加して探す →</Link>{" "}
          <Link href={searchHref.replace("/events/", "/events/map/")}>
            地図で見る →
          </Link>{" "}
          <Link href={searchHref.replace("/events/", "/events/timeline/")}>
            タイムラインで見る →
          </Link>
        </p>
      </section>
      {ended.length > 0 && (
        <section aria-labelledby="archive">
          <h2 id="archive">過去のイベント（{ended.length}件）</h2>
          <EventList events={[...ended].sort(byStartAt).reverse()} />
        </section>
      )}
    </>
  )
}
