import { describe, expect, it } from "vitest"
import events from "@/test/fixtures/events.json"
import {
  effectiveStatus,
  filterEvents,
  formatPeriod,
  jstDate,
  parseQuery,
} from "./event"
import type { Event } from "./types"

const all = events as unknown as Event[]
const now = new Date("2026-10-10T12:00:00+09:00")
const slugs = (qs: string) =>
  filterEvents(all, parseQuery(new URLSearchParams(qs)), now).map((e) => e.slug)

describe("jstDate", () => {
  it("uses Japan time across UTC midnight", () => {
    expect(jstDate("2026-10-09T16:00:00Z")).toBe("2026-10-10")
  })
})

describe("effectiveStatus", () => {
  const e = all[0]
  it("derives status from dates", () => {
    expect(effectiveStatus(e, new Date("2026-10-01T00:00:00+09:00"))).toBe(
      "scheduled"
    )
    expect(effectiveStatus(e, new Date("2026-10-17T12:00:00+09:00"))).toBe(
      "ongoing"
    )
    expect(effectiveStatus(e, new Date("2026-10-19T00:00:00+09:00"))).toBe(
      "ended"
    )
  })
  it("keeps editorial statuses and unknown dates", () => {
    expect(effectiveStatus({ ...e, status: "cancelled" }, now)).toBe(
      "cancelled"
    )
    expect(effectiveStatus({ ...e, startAt: null, endAt: null }, now)).toBe(
      "unknown"
    )
  })
})

describe("formatPeriod", () => {
  it("handles unknown dates", () => {
    expect(formatPeriod({ startAt: null, endAt: null })).toBe("日程未定")
  })
})

describe("filterEvents", () => {
  it("hides ended events unless requested, undated last", () => {
    const res = slugs("")
    expect(res).not.toContain("sample-summer-beer-garden-sapporo-2026")
    expect(res.at(-1)).toBe("sample-shochu-awamori-market-fukuoka")
    expect(slugs("ended=1")).toContain("sample-summer-beer-garden-sapporo-2026")
  })
  it("filters by genre (OR) and prefecture", () => {
    expect(slugs("genre=wine&genre=sake")).toEqual([
      "sample-sakagura-open-niigata-2026",
      "sample-wine-tasting-yamanashi-2026",
    ])
    expect(slugs("pref=東京都")).toEqual(["sample-craft-beer-fes-tokyo-2026"])
  })
  it("filters by overlapping period and excludes undated events", () => {
    expect(slugs("from=2026-10-12&to=2026-10-17")).toEqual([
      "sample-sakagura-open-niigata-2026",
      "sample-craft-beer-fes-tokyo-2026",
    ])
  })
  it("matches keywords with NFKC normalization", () => {
    expect(slugs("q=ｳｲｽｷｰ")).toEqual(["sample-whisky-gin-seminar-osaka-2026"])
    expect(slugs("q=台東区 ビール")).toEqual([
      "sample-craft-beer-fes-tokyo-2026",
    ])
  })
  it("ignores unknown genres in the query", () => {
    expect(parseQuery(new URLSearchParams("genre=juice")).genres).toEqual([])
  })
})

describe("filterEvents (extended conditions)", () => {
  it("filters by city, event type, status and price/reservation", () => {
    expect(slugs("city=甲府")).toEqual(["sample-wine-tasting-yamanashi-2026"])
    expect(slugs("type=seminar")).toEqual([
      "sample-whisky-gin-seminar-osaka-2026",
    ])
    expect(slugs("status=cancelled")).toEqual([
      "sample-cocktail-night-yokohama-2026",
    ])
    expect(slugs("status=ended")).toEqual([
      "sample-summer-beer-garden-sapporo-2026",
    ])
    // Unknown (null) price never counts as free.
    expect(slugs("free=1")).not.toContain(
      "sample-shochu-awamori-market-fukuoka"
    )
    expect(slugs("free=1&noresv=1")).toEqual([
      "sample-sakagura-open-niigata-2026",
      "sample-craft-beer-fes-tokyo-2026",
    ])
  })
  it("sorts by newest", () => {
    expect(slugs("sort=new")[0]).toBe("sample-shochu-awamori-market-fukuoka")
  })
  it("searches producer/product names via extraText", () => {
    const q = parseQuery(new URLSearchParams("q=ペールエール"))
    const res = filterEvents(all, q, now, {
      "evt-sample-0001": "下町ペールエール",
    })
    expect(res.map((e) => e.id)).toEqual(["evt-sample-0001"])
  })
})
