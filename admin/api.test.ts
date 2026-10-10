import { describe, expect, it } from "vitest"
import articles from "@/test/fixtures/articles.json"
import events from "@/test/fixtures/events.json"
import producers from "@/test/fixtures/producers.json"
import products from "@/test/fixtures/products.json"
import sources from "@/test/fixtures/sources.json"
import type { Db, Event } from "../lib/types"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { checkImportUrl, importPage, setPublication, upsert } from "./api"

const NOW = "2026-10-10T12:00:00.000Z"
const fresh = () =>
  structuredClone({
    events,
    sources,
    articles,
    producers,
    products,
  }) as unknown as Db
const ev = (db: Db, id: string) => db.events.find((e) => e.id === id)!

describe("upsert", () => {
  it("updates a record, stamps updatedAt and records changed fields", () => {
    const db = fresh()
    const e = { ...ev(db, "evt-sample-0002"), price: "3,500円" }
    const r = upsert(db, "events", e.id, e, NOW, "update")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(ev(r.db, e.id)).toMatchObject({ price: "3,500円", updatedAt: NOW })
    expect(r.audit).toMatchObject({
      action: "update",
      changedFields: ["price", "updatedAt"],
    })
  })

  it("rejects invalid data without changing anything", () => {
    const db = fresh()
    const e = {
      ...ev(db, "evt-sample-0002"),
      endAt: "2020-01-01T00:00:00+09:00",
    }
    const r = upsert(db, "events", e.id, e, NOW, "update")
    expect(r).toMatchObject({ ok: false, status: 422 })
    expect(ev(db, e.id).endAt).toBe("2026-11-03T17:00:00+09:00")
  })

  it("keeps IDs immutable and publication out of normal edits", () => {
    const db = fresh()
    const e = ev(db, "evt-sample-0002")
    expect(
      upsert(db, "events", e.id, { ...e, id: "other" }, NOW, "update")
    ).toMatchObject({ ok: false })
    const r = upsert(
      db,
      "events",
      e.id,
      { ...e, publication: "hidden" },
      NOW,
      "update"
    )
    expect(r.ok && ev(r.db, e.id).publication).toBe("published")
  })

  it("creates new events as pending; sources can be added but not edited", () => {
    const db = fresh()
    const e: Event = {
      ...ev(db, "evt-sample-0002"),
      id: "evt-new",
      slug: "new-event",
      publication: "published",
    }
    const r = upsert(db, "events", "evt-new", e as never, NOW, "create")
    expect(r.ok && ev(r.db, "evt-new").publication).toBe("pending")
    const s = db.sources[0]
    expect(
      upsert(db, "sources", s.id, { ...s, title: "x" } as never, NOW, "update")
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      upsert(
        db,
        "sources",
        "src-new",
        { ...s, id: "src-new" } as never,
        NOW,
        "create"
      ).ok
    ).toBe(true)
  })
})

describe("setPublication", () => {
  it("publishes, hides and returns to the queue with an audit note", () => {
    const db = fresh()
    const r = setPublication(
      db,
      "evt-sample-0002",
      "hidden",
      " 重複のため ",
      NOW
    )
    expect(r.ok && ev(r.db, "evt-sample-0002").publication).toBe("hidden")
    expect(r.ok && r.audit).toMatchObject({
      action: "hidden",
      note: "重複のため",
    })
  })

  it("refuses to publish events that still need review", () => {
    const db = fresh()
    const e = ev(db, "evt-sample-0002")
    e.verificationStatus = "needs_review"
    e.publication = "pending"
    expect(setPublication(db, e.id, "published", null, NOW)).toMatchObject({
      ok: false,
      status: 422,
    })
  })
})

describe("URL import (Google News discovery)", () => {
  const cfg = JSON.parse(
    readFileSync(join(__dirname, "../collector/config.json"), "utf8")
  )
  const page = `<html><head>
<meta property="og:site_name" content="テスト新聞">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"NewsArticle","headline":"港町でクラフトビールの祭典","datePublished":"2026-10-09T09:00:00+09:00"},
 {"@type":"Event","name":"港町クラフトビールフェス2026","startDate":"2026-11-21T11:00:00+09:00","endDate":"2026-11-22T17:00:00+09:00",
  "location":{"@type":"Place","name":"テスト港公園","address":{"@type":"PostalAddress","addressRegion":"神奈川県","addressLocality":"横浜市","streetAddress":"中区テスト1-1"}}}]}
</script></head><body><article><p>UNSTORED-BODY-MARKER</p></article></body></html>`

  it("rejects Google News links, local hosts and non-http URLs", () => {
    expect(
      checkImportUrl("https://news.google.com/rss/articles/abc")
    ).toContain("元のサイト")
    expect(checkImportUrl("http://127.0.0.1:4321/")).not.toBeNull()
    expect(checkImportUrl("file:///etc/passwd")).not.toBeNull()
    expect(checkImportUrl("https://example.com/news/1")).toBeNull()
  })

  it("uses schema.org Event data and stores a pending event without the body", () => {
    const db = fresh()
    const r = importPage(db, "https://example.com/news/1", page, cfg, NOW)
    expect(r.ok).toBe(true)
    if (!("eventId" in r) || !r.ok) return
    const e = ev(r.db, r.eventId)
    expect(e).toMatchObject({
      title: "港町クラフトビールフェス2026",
      startAt: "2026-11-21T00:00:00+09:00",
      endAt: "2026-11-22T23:59:00+09:00",
      publication: "pending",
      description: null,
      venue: { name: "テスト港公園", prefecture: "神奈川県", city: "横浜市" },
    })
    const src = r.db.sources.find((s) => s.id === e.sourceIds[0])!
    expect(src).toMatchObject({
      sourceType: "news",
      publisher: "テスト新聞",
      publishedAt: "2026-10-09T00:00:00.000Z",
    })
    expect(JSON.stringify(r.db)).not.toContain("UNSTORED-BODY-MARKER")
  })

  it("refuses URLs that are already registered", () => {
    const db = fresh()
    const first = importPage(db, "https://example.com/news/1", page, cfg, NOW)
    if (!first.ok) throw new Error("setup")
    const again = importPage(
      first.db,
      "https://example.com/news/1?utm_source=x",
      page,
      cfg,
      NOW
    )
    expect(again).toMatchObject({
      ok: false,
      status: 409,
      eventId: first.eventId,
    })
  })
})
