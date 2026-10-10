import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import config from "./config.json"
import { normalizeUrl, similarity } from "./dedupe"
import { extract, isRelevant, type KeywordConfig } from "./extract"
import { createFetcher, decodeBody, isAllowed, parseRobots } from "./http"
import { parseFeed } from "./rss"
import { ADAPTERS } from "./sources"
import { loadDb, merge, save } from "./store"
import type { Db } from "../lib/types"

const cfg = config as unknown as KeywordConfig
const NOW = "2026-10-10T00:00:00.000Z"

// Synthetic feeds (no real article content).
const RDF = `<?xml version="1.0"?><rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>PR TIMES</title></channel>
<item rdf:about="https://prtimes.jp/main/html/rd/p/000000001.000000001.html">
<title>テスト醸造所、クラフトビールフェス2026を開催</title>
<link>https://prtimes.jp/main/html/rd/p/000000001.000000001.html</link>
<description>[テスト醸造株式会社]
テスト醸造株式会社（本社：東京都千代田区）は、ビールフェスを開催します。
日時：2026年11月14日(土)〜15日(日) 11:00〜18:00
会場：テスト公園 芝生広場
住所：神奈川県横浜市中区テスト町1-1</description>
<dc:corp>テスト醸造株式会社</dc:corp><dc:date>2026-10-09T10:00:00+09:00</dc:date>
</item>
<item rdf:about="https://prtimes.jp/main/html/rd/p/000000002.000000002.html">
<title>人事のお知らせ</title>
<link>https://prtimes.jp/main/html/rd/p/000000002.000000002.html</link>
<description>[テスト株式会社] 2026年10月1日付の人事。</description>
<dc:date>2026-10-09T11:00:00+09:00</dc:date>
</item></rdf:RDF>`

const RSS2 = `<rss version="2.0"><channel><item>
<title><![CDATA[日本酒の蔵開き &amp; 試飲会 - テスト新聞]]></title>
<link>https://news.google.com/rss/articles/abc?oc=5</link>
<description>&lt;a href="x"&gt;日本酒の蔵開き&lt;/a&gt;&amp;nbsp;</description>
<pubDate>Fri, 09 Oct 2026 03:00:00 GMT</pubDate>
<source url="https://example.com">テスト新聞</source>
</item></channel></rss>`

describe("parseFeed", () => {
  it("parses RSS 1.0 (RDF)", () => {
    const [a] = parseFeed(RDF)
    expect(a.title).toBe("テスト醸造所、クラフトビールフェス2026を開催")
    expect(a.publisher).toBe("テスト醸造株式会社")
    expect(a.publishedAt).toBe("2026-10-09T10:00:00+09:00")
  })
  it("parses RSS 2.0 with CDATA, entities and HTML descriptions", () => {
    const [a] = parseFeed(RSS2)
    expect(a.title).toBe("日本酒の蔵開き & 試飲会 - テスト新聞")
    expect(a.description).toBe("日本酒の蔵開き")
    expect(a.publishedAt).toBe("2026-10-09T03:00:00.000Z")
    expect(a.publisher).toBe("テスト新聞")
  })
})

describe("robots.txt", () => {
  const google = parseRobots(
    "User-agent: *\nDisallow: /\nAllow: /$\nAllow: /topics/\n\nUser-agent: Foo\nAllow: /rss/"
  )
  it("blocks Google News RSS search for generic agents", () => {
    expect(isAllowed(google, "/rss/search?q=x")).toBe(false)
    expect(isAllowed(google, "/topics/abc")).toBe(true)
    expect(isAllowed(google, "/")).toBe(true)
  })
  it("allows PR TIMES RSS", () => {
    const pr = parseRobots("User-agent: *\nAllow: /\nDisallow: /upload/*.m3u8")
    expect(isAllowed(pr, "/index.rdf")).toBe(true)
    expect(isAllowed(pr, "/upload/a/b.m3u8")).toBe(false)
  })
  it("fetcher refuses disallowed URLs without requesting them", async () => {
    const requested: string[] = []
    const fetchImpl = (async (url: string) => {
      requested.push(url)
      return new Response(
        url.endsWith("robots.txt") ? "User-agent: *\nDisallow: /rss" : "ok"
      )
    }) as typeof fetch
    const get = createFetcher({
      userAgent: "t",
      intervalMs: 0,
      timeoutMs: 1000,
      fetchImpl,
    })
    await expect(get("https://news.example/rss/search?q=a")).rejects.toThrow(
      "robots.txt"
    )
    expect(requested).toEqual(["https://news.example/robots.txt"])
  })
})

describe("extract", () => {
  const [item] = parseFeed(RDF)
  it("filters by alcohol + event keywords", () => {
    expect(isRelevant(item.title + item.description, cfg)).toBe(true)
    expect(isRelevant("人事のお知らせ 2026年10月1日付", cfg)).toBe(false)
  })
  it("accepts alcohol-only items unless an event keyword is required", () => {
    const launch = "クラフトビール「テストエール」を発売"
    expect(isRelevant(launch, cfg)).toBe(true)
    expect(isRelevant(launch, { ...cfg, requireEventKeyword: true })).toBe(
      false
    )
    expect(isRelevant("サーバーを新規導入", cfg)).toBe(false)
  })
  it("reads labelled dates, venue and address; ignores HQ prefecture", () => {
    const x = extract(item.title, item.description, cfg)
    expect(x).toMatchObject({
      genres: ["beer"],
      eventTypes: ["festival"],
      startDate: "2026-11-14",
      endDate: "2026-11-15",
      dateSource: "label",
      venueName: "テスト公園 芝生広場",
      prefecture: "神奈川県",
      city: "横浜市",
    })
  })
  it("leaves unknowns null instead of guessing", () => {
    const x = extract(
      "ワインフェス開催",
      "本社：東京都港区。10月17日に開催。",
      cfg
    )
    expect(x.startDate).toBeNull() // no explicit year
    expect(x.prefecture).toBeNull() // HQ is not the venue
    expect(x.venueName).toBeNull()
  })
  it("does not read an hour as the end day", () => {
    const x = extract(
      "日本酒イベント",
      "日時：2026年10月17日 11:00〜18:00",
      cfg
    )
    expect([x.startDate, x.endDate]).toEqual(["2026-10-17", "2026-10-17"])
  })
  it("rejects impossible dates and ambiguous year-crossing ranges", () => {
    expect(extract("ビールフェス", "2026年2月30日", cfg).startDate).toBeNull()
    const x = extract("ビールフェス", "2026年12月30日〜1月2日", cfg)
    expect([x.startDate, x.endDate]).toEqual(["2026-12-30", "2026-12-30"])
  })
})

describe("dedupe", () => {
  it("normalizes tracking params, case, fragments and trailing slashes", () => {
    expect(
      normalizeUrl("http://WWW.Example.com/a/?utm_source=x&b=2&a=1#top")
    ).toBe("https://example.com/a?a=1&b=2")
  })
  it("scores similar titles", () => {
    expect(
      similarity("【PR】クラフトビールフェス2026", "クラフトビールフェス 2026")
    ).toBe(1)
    expect(similarity("クラフトビールフェス", "ワイン試飲会")).toBeLessThan(0.3)
  })
})

const emptyDb = (): Db => ({
  events: [],
  sources: [],
  articles: [],
  producers: [],
  products: [],
})

describe("merge", () => {
  const items = parseFeed(RDF).map((i) => ({
    sourceType: "prtimes" as const,
    item: {
      url: i.link,
      title: i.title,
      summary: i.description,
      publisher: i.publisher,
      publishedAt: i.publishedAt,
    },
  }))

  it("adds relevant items as unverified events with a linked source, without the body", () => {
    const { db, stats } = merge(emptyDb(), items, cfg, NOW)
    expect(stats).toMatchObject({ fetched: 2, irrelevant: 1, added: 1 })
    const [e] = db.events
    expect(e).toMatchObject({
      startAt: "2026-11-14T00:00:00+09:00",
      endAt: "2026-11-15T23:59:00+09:00",
      dateOnly: true,
      isSample: false,
      description: null,
      verificationStatus: "unverified",
      publication: "pending",
    })
    expect(db.sources[0]).toMatchObject({
      relatedEventIds: [e.id],
      fetchedAt: NOW,
      sourceType: "prtimes",
    })
    expect(JSON.stringify(db)).not.toContain("本社")
  })

  it("puts alcohol items without event words in review", () => {
    const launch = [
      {
        sourceType: "prtimes" as const,
        item: {
          url: "https://example.com/launch",
          title: "テスト醸造、新作クラフトビールを発売",
          summary: "日時：2026年11月1日 発売。住所：東京都台東区テスト1-1",
          publisher: null,
          publishedAt: null,
        },
      },
    ]
    const { db, stats } = merge(emptyDb(), launch, cfg, NOW)
    expect(stats.added).toBe(1)
    expect(db.events[0]).toMatchObject({
      verificationStatus: "needs_review",
      publication: "pending",
    })
    expect(db.sources[0].extractedFields).toMatchObject({
      eventKeywordMatched: false,
    })
  })

  it("skips known URLs and never modifies existing records", () => {
    const first = merge(emptyDb(), items, cfg, NOW).db
    const before = JSON.stringify(first)
    const withTracking = items.map((x) => ({
      ...x,
      item: { ...x.item, url: x.item.url + "?utm_source=rss" },
    }))
    const { db, stats } = merge(
      first,
      withTracking,
      cfg,
      "2026-10-11T00:00:00.000Z"
    )
    expect(stats).toMatchObject({ duplicateUrl: 1, added: 0 })
    expect(JSON.stringify(db)).toBe(before)
  })

  it("flags look-alike events as candidates instead of merging", () => {
    const first = merge(emptyDb(), items, cfg, NOW).db
    const other = [
      {
        ...items[0],
        item: { ...items[0].item, url: "https://example.com/other" },
      },
    ]
    const { db, candidates } = merge(first, other, cfg, NOW)
    expect(db.events).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      candidateEventId: first.events[0].id,
    })
    expect(db.events[1].verificationStatus).toBe("needs_review")
  })

  it("prtimes adapter strips the [company] prefix", async () => {
    const got = await ADAPTERS.prtimes_rss.fetchItems(
      {
        id: "prtimes",
        adapter: "prtimes_rss",
        enabled: true,
        url: "https://x",
      },
      async () => RDF,
      { isKnown: () => false, isCandidateTitle: () => true, log: () => {} }
    )
    expect(got[0].summary.startsWith("テスト醸造株式会社（本社")).toBe(true)
  })
})

describe("save", () => {
  it("writes valid data and refuses to write invalid data", () => {
    const dir = mkdtempSync(join(tmpdir(), "sake-eve-"))
    for (const c of ["events", "sources", "articles", "producers", "products"])
      writeFileSync(join(dir, `${c}.json`), "[]\n")
    const items = parseFeed(RDF).map((i) => ({
      sourceType: "prtimes" as const,
      item: {
        url: i.link,
        title: i.title,
        summary: i.description,
        publisher: i.publisher,
        publishedAt: i.publishedAt,
      },
    }))
    const { db } = merge(loadDb(dir), items, cfg, NOW)
    expect(save(dir, db, [])).toEqual([])
    expect(loadDb(dir).events).toHaveLength(1)

    const broken = {
      ...db,
      events: [{ ...db.events[0], sourceIds: ["missing"] }],
    }
    expect(save(dir, broken, []).length).toBeGreaterThan(0)
    expect(
      JSON.parse(readFileSync(join(dir, "events.json"), "utf8"))[0].sourceIds
    ).toEqual(db.events[0].sourceIds)
  })
})

describe("extraction guards for full release bodies", () => {
  it("ignores the company profile block and prefers venue prefecture", () => {
    const x = extract(
      "クラフトビール総選挙 in 神戸を開催",
      "日時：2026年10月21日〜2026年10月25日\n会場：サンキタ広場(兵庫県神戸市中央区)\n【会社概要】\n所在地：東京都港区テスト1-1",
      cfg
    )
    expect(x.prefecture).toBe("兵庫県")
    expect(x.address).toBeNull()
  })
  it("takes genres from the title when it names one", () => {
    expect(
      extract("ワイン試飲会を開催", "ビールやウイスキーも少し用意", cfg).genres
    ).toEqual(["wine"])
    expect(extract("秋の試飲会を開催", "日本酒とワイン", cfg).genres).toEqual([
      "wine",
      "sake",
    ])
  })
  it("drops an unlabelled date equal to the release date", () => {
    const item = {
      url: "https://example.com/r1",
      title: "テストビールフェス開催",
      summary:
        "テスト株式会社は2026年10月10日、ビールフェスの開催を決定しました。",
      publisher: null,
      publishedAt: "2026-10-10T11:00:02+09:00",
    }
    const { db } = merge(emptyDb(), [{ sourceType: "prtimes", item }], cfg, NOW)
    expect(db.events[0].startAt).toBeNull()
  })
})

describe("decodeBody", () => {
  it("decodes Shift_JIS via meta charset and HTTP header", () => {
    // "ビール" in Shift_JIS
    const sjis = new Uint8Array([0x83, 0x72, 0x81, 0x5b, 0x83, 0x8b])
    const html = new Uint8Array([
      ...new TextEncoder().encode('<meta charset="Shift_JIS">'),
      ...sjis,
    ])
    expect(decodeBody(html, "text/html")).toContain("ビール")
    expect(decodeBody(sjis, "text/html; charset=Shift_JIS")).toBe("ビール")
    expect(decodeBody(new TextEncoder().encode("ビール"), null)).toBe("ビール")
  })
})
