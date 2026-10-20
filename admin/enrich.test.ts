import { describe, expect, it } from "vitest"
import events from "@/test/fixtures/events.json"
import sources from "@/test/fixtures/sources.json"
import type { Db, Event, Source } from "../lib/types"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { enrichFromSources, fillMissing, isFetchable } from "./enrich"
import { extract, type KeywordConfig } from "../collector/extract"

const cfg = JSON.parse(
  readFileSync(join(__dirname, "../collector/config.json"), "utf8")
) as KeywordConfig

const db = () =>
  ({
    events,
    sources,
    articles: [],
    producers: [],
    products: [],
  }) as unknown as Db

const event = (id: string): Event =>
  structuredClone(db().events.find((e) => e.id === id)!) as Event

const source = (id: string): Source =>
  structuredClone(db().sources.find((s) => s.id === id)!) as Source

/** A pending event with almost nothing filled in (like a collected one). */
const pending = (): Event => ({
  ...event("evt-sample-0002"),
  id: "evt-pending",
  slug: "pending-event",
  title: "港町クラフトビールフェス2026",
  genres: ["other"],
  eventTypes: ["other"],
  startAt: null,
  endAt: null,
  venue: {
    name: null,
    address: null,
    prefecture: null,
    city: null,
    latitude: null,
    longitude: null,
  },
  officialUrl: null,
  imageUrl: null,
  sourceIds: ["src-pending"],
  publication: "pending",
  verificationStatus: "needs_review",
})

const page = `<html><head>
<meta property="og:site_name" content="テスト新聞">
<meta property="og:image" content="https://example.com/img/fes.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"NewsArticle","headline":"港町でクラフトビールの祭典","datePublished":"2026-10-09T09:00:00+09:00"},
 {"@type":"Event","name":"港町クラフトビールフェス2026","startDate":"2026-11-21T11:00:00+09:00","endDate":"2026-11-22T17:00:00+09:00",
  "location":{"@type":"Place","name":"テスト港公園","address":{"@type":"PostalAddress","addressRegion":"神奈川県","addressLocality":"横浜市","streetAddress":"中区テスト1-1"}}}]}
</script></head><body><article><p>会場：テスト港公園</p><p>住所：神奈川県横浜市中区テスト1-1</p></article></body></html>`

describe("fillMissing", () => {
  it("fills empty fields from the extracted values", () => {
    const x = extract(
      "港町クラフトビールフェス2026",
      "日時：2026年11月21日〜22日\n会場：テスト港公園\n住所：神奈川県横浜市中区テスト1-1\n公式サイト：https://example.com/fes",
      cfg,
      "2026-10-09T09:00:00+09:00"
    )
    const r = fillMissing(pending(), x, "https://example.com/img/fes.jpg")
    expect(r.filled).toEqual(
      expect.arrayContaining([
        "startAt",
        "venueName",
        "address",
        "prefecture",
        "city",
        "officialUrl",
        "imageUrl",
      ])
    )
    expect(r.event).toMatchObject({
      startAt: "2026-11-21T00:00:00+09:00",
      endAt: "2026-11-22T23:59:00+09:00",
      dateOnly: true,
      officialUrl: "https://example.com/fes",
      venue: {
        name: "テスト港公園",
        address: "神奈川県横浜市中区テスト1-1",
        prefecture: "神奈川県",
        city: "横浜市",
      },
      imageUrl: "https://example.com/img/fes.jpg",
    })
  })

  it("never overwrites values the editor entered", () => {
    const base = pending()
    base.venue.name = "手入力の会場"
    base.startAt = "2026-12-01T10:00:00+09:00"
    base.genres = ["wine"]
    const x = extract(
      "港町クラフトビールフェス2026",
      "日時：2026年11月21日\n会場：テスト港公園\n住所：神奈川県横浜市中区テスト1-1",
      cfg,
      "2026-10-09T09:00:00+09:00"
    )
    const r = fillMissing(base, x, null)
    expect(r.event.startAt).toBe("2026-12-01T10:00:00+09:00")
    expect(r.event.venue.name).toBe("手入力の会場")
    expect(r.event.genres).toEqual(["wine"])
    expect(r.filled).not.toContain("startAt")
    expect(r.filled).not.toContain("venueName")
    expect(r.filled).not.toContain("genres")
  })

  it("replaces the fallback genre and type when the source states them", () => {
    const x = extract(
      "港町クラフトビールフェス2026",
      "日時：2026年11月21日",
      cfg,
      "2026-10-09T09:00:00+09:00"
    )
    const r = fillMissing(pending(), x, null)
    expect(r.event.genres).toEqual(["beer"])
    expect(r.event.eventTypes).toEqual(["festival"])
    expect(r.filled).toEqual(expect.arrayContaining(["genres", "eventTypes"]))
  })
})

describe("enrichFromSources", () => {
  it("reads the source page and fills the pending event", async () => {
    const s: Source = {
      ...source("src-sample-0001"),
      id: "src-pending",
      sourceType: "news",
      url: "https://example.com/news/1",
      publishedAt: "2026-10-09T09:00:00+09:00",
    }
    const r = await enrichFromSources(pending(), [s], async () => page, cfg)
    expect(r.errors).toEqual([])
    expect(r.pages).toHaveLength(1)
    expect(r.event).toMatchObject({
      startAt: "2026-11-21T00:00:00+09:00",
      endAt: "2026-11-22T23:59:00+09:00",
      venue: { name: "テスト港公園", prefecture: "神奈川県" },
      imageUrl: "https://example.com/img/fes.jpg",
    })
    // The body of the source page is never stored.
    expect(JSON.stringify(r.event)).not.toContain("<p>")
  })

  it("reports a failing source instead of throwing", async () => {
    const s: Source = {
      ...source("src-sample-0001"),
      id: "src-pending",
      sourceType: "news",
      url: "https://example.com/news/1",
    }
    const r = await enrichFromSources(
      pending(),
      [s],
      async () => {
        throw new Error("HTTP 500: https://example.com/news/1")
      },
      cfg
    )
    expect(r.extracted).toBeNull()
    expect(r.errors[0]).toContain("HTTP 500")
    expect(r.event.startAt).toBeNull()
  })

  it("never fetches Google News or sample sources", () => {
    expect(
      isFetchable({
        ...source("src-sample-0001"),
        sourceType: "sample",
        url: "https://example.com/sample/source-0001",
      })
    ).toBe(false)
    expect(
      isFetchable({
        ...source("src-sample-0001"),
        sourceType: "google_news",
        url: "https://news.google.com/rss/articles/abc",
      })
    ).toBe(false)
    expect(
      isFetchable({
        ...source("src-sample-0001"),
        sourceType: "news",
        url: "https://example.com/news/1",
      })
    ).toBe(true)
  })
})
