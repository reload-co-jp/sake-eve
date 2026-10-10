import { effectiveStatus } from "./event"
import type { Event } from "./types"

/** Site origin for canonical URLs, sitemap and structured data. Set SITE_URL at build time. */
export const SITE_URL = (
  process.env.SITE_URL ?? "http://localhost:3000"
).replace(/\/+$/, "")

const STATUS = {
  cancelled: "https://schema.org/EventCancelled",
  postponed: "https://schema.org/EventPostponed",
} as const

/**
 * schema.org Event built only from what the page shows. Returns null for
 * sample data or events without a date (startDate is required).
 */
export const eventJsonLd = (e: Event) => {
  if (e.isSample || !e.startAt) return null
  const s = effectiveStatus(e)
  const v = e.venue
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    url: `${SITE_URL}/events/${e.slug}/`,
    // Date-only events must not claim a time.
    startDate: e.dateOnly ? e.startAt.slice(0, 10) : e.startAt,
    ...(e.endAt && { endDate: e.dateOnly ? e.endAt.slice(0, 10) : e.endAt }),
    eventStatus:
      s === "cancelled" || s === "postponed"
        ? STATUS[s]
        : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(e.description && { description: e.description }),
    ...((v.name || v.prefecture) && {
      location: {
        "@type": "Place",
        ...(v.name && { name: v.name }),
        address: {
          "@type": "PostalAddress",
          addressCountry: "JP",
          ...(v.prefecture && { addressRegion: v.prefecture }),
          ...(v.city && { addressLocality: v.city }),
          ...(v.address && { streetAddress: v.address }),
        },
        ...(v.latitude !== null && {
          geo: {
            "@type": "GeoCoordinates",
            latitude: v.latitude,
            longitude: v.longitude,
          },
        }),
      },
    }),
    ...(e.organizer && {
      organizer: { "@type": "Organization", name: e.organizer },
    }),
  }
}

/** Safe to embed in <script type="application/ld+json">. */
export const jsonLdHtml = (data: object) =>
  JSON.stringify(data).replace(/</g, "\\u003c")
