import { effectiveStatus } from "./event"
import type { Event } from "./types"

/** Site origin for canonical URLs, sitemap and structured data. Set SITE_URL at build time. */
// `||`, not `??`: an unset GitHub Actions variable arrives as an empty string.
const rawSiteUrl =
  process.env.SITE_URL?.trim() || "https://sake-eve.reload.co.jp"
if (!URL.canParse(rawSiteUrl))
  throw new Error(
    `SITE_URL が不正なURLです: "${rawSiteUrl}"（例: https://sake-eve.example.jp）`
  )
export const SITE_URL = rawSiteUrl.replace(/\/+$/, "")

/** Next.js replaces (not merges) a parent's openGraph, so pages spread this. */
export const OPEN_GRAPH_BASE = {
  siteName: "サケイベ！",
  locale: "ja_JP",
  type: "website",
} as const

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
    ...(e.imageUrl && { image: [new URL(e.imageUrl, SITE_URL).href] }),
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
