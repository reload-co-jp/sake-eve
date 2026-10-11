import Link from "next/link"
import { FC } from "react"
import { effectiveStatus, formatPeriod } from "@/lib/event"
import {
  EVENT_STATUSES,
  GENRES,
  VERIFICATION_STATUSES,
  type Event,
} from "@/lib/types"

export const StatusBadge: FC<{ event: Event }> = ({ event }) => {
  const s = effectiveStatus(event)
  return (
    <>
      {event.isSample && <span className="badge badge-sample">サンプル</span>}
      <span className={`badge status-${s}`}>{EVENT_STATUSES[s]}</span>
    </>
  )
}

export const GenreTags: FC<{ event: Event }> = ({ event }) => (
  <ul className="tags" aria-label="酒類ジャンル">
    {event.genres.map((g) => (
      <li key={g} className={`tag genre-${g}`}>
        {GENRES[g]}
      </li>
    ))}
  </ul>
)

export const eventPlace = ({ venue }: Event) =>
  [venue.prefecture, venue.city, venue.name].filter(Boolean).join(" ") ||
  "会場未定"

export const EventCard: FC<{ event: Event }> = ({ event }) => {
  return (
    <article className="card">
      {event.imageUrl && (
        // Hotlinked source image; alt is empty because the title follows.
        <img
          className="card-image"
          src={event.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <p className="card-date">
        <StatusBadge event={event} />
        <time dateTime={event.startAt ?? undefined}>{formatPeriod(event)}</time>
      </p>
      <h3 className="card-title">
        <Link href={`/events/${event.slug}/`}>{event.title}</Link>
      </h3>
      <p className="card-place">{eventPlace(event)}</p>
      <GenreTags event={event} />
      <p className="card-meta">
        情報確認: {VERIFICATION_STATUSES[event.verificationStatus]} ／ 出典
        {event.sourceIds.length}件（詳細ページに掲載）
      </p>
    </article>
  )
}

export const EventList: FC<{ events: Event[] }> = ({ events }) => (
  <ul className="card-list">
    {events.map((e) => (
      <li key={e.id}>
        <EventCard event={e} />
      </li>
    ))}
  </ul>
)
