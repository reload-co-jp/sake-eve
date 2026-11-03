import { describe, expect, it } from "vitest"
import type { Db, Event, Source } from "../lib/types"
import { autoReview } from "./auto-review"
import {
  applyReview,
  checkFacts,
  parseAnswer,
  prefectureOf,
  type ReviewAnswer,
} from "./review"

const NOW = "2026-11-01T00:00:00.000Z"
const BODY = `大阪・船場で日本酒の飲み歩きイベント「おいしいSAKEウォーク」を開催します。
■開催概要
日時：2026年11月21日（土）12:00〜18:00
会場：肥後橋・淀屋橋・本町エリアの飲食店
受付：大阪府大阪市西区江戸堀1-9-1
参加費：前売4,000円（要事前申込）
公式サイト：https://example.org/sake-walk/`

const q = <T>(value: T | null, quote: string | null = null) => ({
  value,
  quote,
})

const answer = (over: Partial<ReviewAnswer> = {}): ReviewAnswer => ({
  isEvent: true,
  reason: "一般参加の飲み歩きイベント",
  name: "おいしいSAKEウォーク",
  description:
    "全国の酒蔵の日本酒を飲み歩きで楽しめる。料理とのペアリングもある。",
  startDate: q("2026-11-21", "日時：2026年11月21日（土）"),
  endDate: q("2026-11-21", "2026年11月21日"),
  venueName: q(
    "肥後橋・淀屋橋・本町エリア",
    "会場：肥後橋・淀屋橋・本町エリア"
  ),
  address: q("大阪府大阪市西区江戸堀1-9-1", "大阪府大阪市西区江戸堀1-9-1"),
  prefecture: q("大阪府", "大阪府大阪市"),
  city: q("大阪市西区", "大阪市西区"),
  price: q("前売4,000円", "参加費：前売4,000円"),
  isFree: q(false, "前売4,000円"),
  reservationRequired: q(true, "要事前申込"),
  officialUrl: q(
    "https://example.org/sake-walk/",
    "https://example.org/sake-walk/"
  ),
  organizer: q(null),
  ...over,
})

const event = (over: Partial<Event> = {}): Event => ({
  id: "evt-1",
  slug: "e-1",
  title: "船場で日本酒飲み歩きイベント",
  description: null,
  genres: ["sake"],
  eventTypes: ["festival"],
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
  organizer: null,
  officialUrl: null,
  ticketUrl: null,
  imageUrl: null,
  price: null,
  isFree: null,
  reservationRequired: null,
  sourceIds: ["src-1"],
  producerIds: [],
  productIds: [],
  articleIds: [],
  status: "unknown",
  verificationStatus: "needs_review",
  lastVerifiedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  dateOnly: true,
  isSample: false,
  publication: "pending",
  ...over,
})

const ctx = {
  now: NOW,
  sourceTitle: "船場で日本酒飲み歩きイベント",
  hasDuplicates: false,
}
const PUB = "2026-10-23T00:00:00Z"

describe("checkFacts", () => {
  it("keeps quote-backed facts (ignoring width and spacing)", () => {
    const { facts, rejected } = checkFacts(answer(), BODY, PUB)
    expect(rejected).toEqual([])
    expect(facts).toMatchObject({
      startDate: "2026-11-21",
      venueName: "肥後橋・淀屋橋・本町エリア",
      prefecture: "大阪府",
      price: "前売4,000円",
      isFree: false,
      reservationRequired: true,
      officialUrl: "https://example.org/sake-walk/",
    })
  })

  it("drops facts whose quote is not in the page", () => {
    const { facts, rejected } = checkFacts(
      answer({
        venueName: q("大阪城ホール", "会場：大阪城ホール"),
        price: q("3,000円", null),
      }),
      BODY,
      PUB
    )
    expect(facts.venueName).toBeNull()
    expect(facts.price).toBeNull()
    expect(rejected.sort()).toEqual(["price", "venueName"])
  })

  it("rejects URLs not written in the page and dates far from the release", () => {
    const { facts, rejected } = checkFacts(
      answer({
        officialUrl: q(
          "https://other.example/",
          "公式サイト：https://example.org/sake-walk/"
        ),
        startDate: q("2028-11-21", "2026年11月21日"),
      }),
      BODY,
      PUB
    )
    expect(facts.officialUrl).toBeNull()
    expect(facts.startDate).toBeNull()
    expect(facts.endDate).toBeNull()
    expect(rejected.sort()).toEqual(["officialUrl", "startDate"])
  })

  it("takes the prefecture from the address when not stated", () => {
    const { facts } = checkFacts(answer({ prefecture: q(null) }), BODY, PUB)
    expect(facts.prefecture).toBe("大阪府")
    expect(prefectureOf("〒550-0002 大阪府大阪市")).toBe("大阪府")
    expect(prefectureOf("大阪市西区")).toBeNull()
  })
})

describe("applyReview", () => {
  it("fills empty fields and publishes a confirmed upcoming event", () => {
    const a = answer()
    const r = applyReview(event(), a, checkFacts(a, BODY, PUB), ctx)
    expect(r.record.decision).toBe("published")
    expect(r.event).toMatchObject({
      title: "おいしいSAKEウォーク",
      startAt: "2026-11-21T00:00:00+09:00",
      endAt: "2026-11-21T23:59:00+09:00",
      status: "scheduled",
      price: "前売4,000円",
      isFree: false,
      publication: "published",
      verificationStatus: "partially_verified",
    })
    expect(r.event.venue.prefecture).toBe("大阪府")
    expect(r.audit.map((x) => x.action)).toEqual(["update", "published"])
    expect(r.audit[1].note).toMatch(/^auto-review:/)
  })

  it("never overwrites what an editor entered", () => {
    const a = answer()
    const r = applyReview(
      event({
        title: "編集者のタイトル",
        price: "当日5,000円",
        venue: { ...event().venue, name: "編集者の会場" },
      }),
      a,
      checkFacts(a, BODY, PUB),
      ctx
    )
    expect(r.event.title).toBe("編集者のタイトル")
    expect(r.event.price).toBe("当日5,000円")
    expect(r.event.venue.name).toBe("編集者の会場")
  })

  it("hides non-events", () => {
    const a = answer({ isEvent: false, reason: "新商品の発売告知" })
    const r = applyReview(event(), a, checkFacts(a, BODY, PUB), ctx)
    expect(r.record.decision).toBe("hidden")
    expect(r.event.publication).toBe("hidden")
    expect(r.event.title).toBe(ctx.sourceTitle)
    expect(r.audit.at(-1)?.note).toBe("auto-review: 新商品の発売告知")
  })

  it("leaves unconfirmed or look-alike events for an editor", () => {
    const a = answer({ venueName: q("どこか", "会場：どこか") })
    const r = applyReview(event(), a, checkFacts(a, BODY, PUB), {
      ...ctx,
      hasDuplicates: true,
    })
    expect(r.record.decision).toBe("pending")
    expect(r.record.todo).toEqual(["会場", "重複候補"])
    expect(r.event.publication).toBe("pending")
    expect(r.event.verificationStatus).toBe("needs_review")
  })

  it("does not publish when the stored date differs from the source", () => {
    const a = answer()
    const r = applyReview(
      event({ startAt: "2026-12-01T00:00:00+09:00", endAt: null }),
      a,
      checkFacts(a, BODY, PUB),
      ctx
    )
    expect(r.record.todo).toContain("開催日が出典と異なる")
  })
})

it("parseAnswer reads the JSON object out of model output", () => {
  expect(
    parseAnswer("```json\n" + JSON.stringify(answer()) + "\n```")?.name
  ).toBe("おいしいSAKEウォーク")
  expect(parseAnswer("no json")).toBeNull()
})

describe("autoReview", () => {
  const source: Source = {
    id: "src-1",
    sourceType: "news",
    url: "https://news.example/a",
    title: ctx.sourceTitle,
    publisher: null,
    publishedAt: PUB,
    fetchedAt: NOW,
    contentHash: "x",
    relatedEventIds: ["evt-1"],
    processingStatus: "needs_review",
    extractedFields: null,
  } as Source
  const db = (events: Event[]): Db => ({
    events,
    sources: [source],
    articles: [],
    producers: [],
    products: [],
  })

  it("uses bodies fetched this run, skips reviewed events and respects the limit", async () => {
    const asked: string[] = []
    const r = await autoReview(
      db([
        event(),
        event({ id: "evt-2", slug: "e-2", title: "札幌ワインマルシェ" }),
      ]),
      {
        ask: async (title, _p, body) => {
          asked.push(body)
          return answer()
        },
        fetchText: async () => {
          throw new Error("should not fetch")
        },
        now: NOW,
        limit: 5,
        records: [
          {
            eventId: "evt-2",
            reviewedAt: NOW,
            decision: "pending",
            reason: "",
            filled: [],
            todo: [],
            rejected: [],
          },
        ],
        bodies: new Map([["https://news.example/a", BODY]]),
      }
    )
    expect(asked).toEqual([BODY])
    expect(r.stats).toMatchObject({ reviewed: 1, published: 1 })
    expect(r.db.events[0].publication).toBe("published")
    expect(r.db.events[1].publication).toBe("pending")
  })

  it("counts failures without stopping", async () => {
    const r = await autoReview(db([event()]), {
      ask: async () => null,
      fetchText: async () => "<html><body>本文</body></html>",
      now: NOW,
      limit: 5,
      records: [],
    })
    expect(r.stats.failed).toBe(1)
    expect(r.records).toEqual([])
  })
})
