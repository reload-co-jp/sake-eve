import { describe, expect, it } from "vitest"
import { BlockedError } from "./http"
import { parseRelease, parseSearch, searchUrl } from "./prtimes"
import { ADAPTERS, type AdapterContext } from "./sources"

// Synthetic pages mirroring PR TIMES markup (no real content).
const article = (id: string, title: string) =>
  `<article class="_article_x"><a class="_link_x" href="/main/html/rd/p/${id}.html"><div><h3 class="_title_x">${title}</h3><time>1時間前</time></div></a><span><a href="/main/html/searchrlp/company_id/1">テスト株式会社</a></span></article>`
const SEARCH = `<html><body><section>${article("000000001.000000001", "テストビールフェス2026開催…")}${article("000000002.000000002", "新サービス提供開始")}${article("000000003.000000003", "ワイン試飲会のお知らせ")}</section></body></html>`
const release = (title: string, body: string) =>
  `<html><head><script type="application/ld+json">[{"@context":"https://schema.org","@type":"NewsArticle","headline":${JSON.stringify(title)},"datePublished":"2026-10-10 11:00:02","author":{"@type":"Organization","name":"テスト株式会社"}}]</script></head><body><article><p>${body}</p></article></body></html>`

describe("parseSearch / parseRelease", () => {
  it("reads result links, titles and companies", () => {
    expect(parseSearch(SEARCH)[0]).toEqual({
      url: "https://prtimes.jp/main/html/rd/p/000000001.000000001.html",
      title: "テストビールフェス2026開催…",
      company: "テスト株式会社",
    })
  })
  it("reads JSON-LD headline/date/author and body text", () => {
    const r = parseRelease(
      release(
        "テストビールフェス2026を開催",
        "日時：2026年11月14日<br>会場：テスト公園"
      )
    )
    expect(r).toMatchObject({
      title: "テストビールフェス2026を開催",
      publishedAt: "2026-10-10T11:00:02+09:00",
      publisher: "テスト株式会社",
    })
    expect(r!.body).toContain("日時：2026年11月14日\n会場：テスト公園")
    expect(parseRelease("<html></html>")).toBeNull()
  })
})

describe("prtimes_search adapter", () => {
  const source = {
    id: "prtimes_search",
    adapter: "prtimes_search",
    enabled: true,
    queries: [
      { q: "ビール イベント", genre: "beer" },
      { q: "ワイン", genre: "wine" },
    ],
    maxDetailFetches: 1,
  }
  const ctx = (known: string[] = []): AdapterContext & { notes: string[] } => {
    const notes: string[] = []
    return {
      notes,
      isKnown: (u) => known.includes(u),
      isCandidateTitle: (t) => /ビール|ワイン|試飲/.test(t),
      log: (m) => notes.push(m),
    }
  }

  it("fetches details only for new candidate titles, capped per run", async () => {
    const requested: string[] = []
    const c = ctx([
      "https://prtimes.jp/main/html/rd/p/000000001.000000001.html",
    ])
    const items = await ADAPTERS.prtimes_search.fetchItems(
      source,
      async (url) => {
        requested.push(url)
        return url.includes("searchkey")
          ? SEARCH
          : release("ワイン試飲会を開催", "会場：テストホール")
      },
      c
    )
    expect(requested.filter((u) => u.includes("searchkey"))).toEqual([
      searchUrl("ビール イベント"),
      searchUrl("ワイン"),
    ])
    // #1 known, #2 not a candidate title, #3 fetched
    expect(requested.filter((u) => u.includes("/rd/p/"))).toEqual([
      "https://prtimes.jp/main/html/rd/p/000000003.000000003.html",
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: "ワイン試飲会を開催",
      publisher: "テスト株式会社",
    })
    expect(c.notes[0]).toContain("候補1件")
  })

  it("stops on access restrictions instead of continuing", async () => {
    await expect(
      ADAPTERS.prtimes_search.fetchItems(
        { ...source, maxDetailFetches: 5 },
        async (url) => {
          if (url.includes("searchkey")) return SEARCH
          throw new BlockedError("HTTP 429")
        },
        ctx()
      )
    ).rejects.toThrow("429")
  })
})
