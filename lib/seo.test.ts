import { describe, expect, it } from "vitest"
import events from "@/test/fixtures/events.json"
import {
  eventJsonLd,
  isIndexableListing,
  isSitemapEvent,
  jsonLdHtml,
} from "./seo"
import type { Event } from "./types"

const sample = (events as unknown as Event[]).find(
  (e) => e.id === "evt-sample-0007"
)!
const real: Event = { ...sample, isSample: false }

describe("eventJsonLd", () => {
  it("is omitted for sample data and undated events", () => {
    expect(eventJsonLd(sample)).toBeNull()
    expect(eventJsonLd({ ...real, startAt: null, endAt: null })).toBeNull()
  })
  it("uses only shown fields and maps cancelled status", () => {
    const ld = eventJsonLd(real)!
    expect(ld).toMatchObject({
      "@type": "Event",
      startDate: "2026-10-24T18:00:00+09:00",
      eventStatus: "https://schema.org/EventCancelled",
      location: {
        name: real.venue.name,
        address: { addressRegion: "神奈川県" },
      },
    })
    expect(ld).not.toHaveProperty("offers")
    expect(
      eventJsonLd({ ...real, imageUrl: "https://x.jp/a.jpg" })!.image
    ).toEqual(["https://x.jp/a.jpg"])
  })
  it("drops times for date-only events and escapes </script>", () => {
    expect(eventJsonLd({ ...real, dateOnly: true })!.startDate).toBe(
      "2026-10-24"
    )
    expect(jsonLdHtml({ name: "</script><x>" })).not.toContain("</script>")
  })
})

describe("isIndexableListing / isSitemapEvent", () => {
  const now = new Date("2026-11-10T12:00:00+09:00")
  const ended: Event = {
    ...real,
    status: "unknown",
    startAt: "2026-10-01T10:00:00+09:00",
    endAt: "2026-10-01T17:00:00+09:00",
  }
  const upcoming: Event = {
    ...real,
    status: "unknown",
    startAt: "2026-12-01T10:00:00+09:00",
    endAt: "2026-12-01T17:00:00+09:00",
  }
  it("indexes listings only when an event is not over", () => {
    expect(isIndexableListing([], now)).toBe(false)
    expect(isIndexableListing([ended], now)).toBe(false)
    expect(isIndexableListing([ended, upcoming], now)).toBe(true)
  })
  it("keeps ended events out of the sitemap", () => {
    expect(isSitemapEvent(ended, now)).toBe(false)
    expect(isSitemapEvent(upcoming, now)).toBe(true)
  })
})
