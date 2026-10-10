/**
 * Source adapters. Each adapter only fetches and normalises feed items;
 * extraction, dedupe and storage are shared. Add a new source by adding an adapter here
 * and an entry in config.json.
 */
import type { SourceType } from "../lib/types.ts"
import { BlockedError, type FetchText } from "./http.ts"
import { parseRelease, parseSearch, searchUrl } from "./prtimes.ts"
import { parseFeed } from "./rss.ts"

export type SourceConfig = {
  id: string
  adapter: string
  enabled: boolean
  disabledReason?: string
  url?: string
  queries?: { q: string; genre: string | null }[]
  /** Scheduled runs only fetch this source every N hours (UTC hour % N === 0). */
  runEveryHours?: number
  /** Upper bound of detail-page requests per run; the rest is picked up next time. */
  maxDetailFetches?: number
}

export type AdapterContext = {
  /** Already stored (normalized URL match): skip without fetching details. */
  isKnown: (url: string) => boolean
  /** Cheap pre-filter on listing titles before fetching a detail page. */
  isCandidateTitle: (title: string) => boolean
  log: (message: string) => void
}

/** A feed item. `summary` is used for extraction only and is never stored. */
export type RawItem = {
  url: string
  title: string
  summary: string
  publisher: string | null
  publishedAt: string | null
}

export type Adapter = {
  sourceType: SourceType
  fetchItems: (
    source: SourceConfig,
    fetchText: FetchText,
    ctx: AdapterContext
  ) => Promise<RawItem[]>
}

const fromFeed = (xml: string): RawItem[] =>
  parseFeed(xml).map((i) => ({
    url: i.link,
    title: i.title,
    summary: i.description,
    publisher: i.publisher,
    publishedAt: i.publishedAt,
  }))

export const ADAPTERS: Record<string, Adapter> = {
  prtimes_rss: {
    sourceType: "prtimes",
    fetchItems: async (source, fetchText) =>
      fromFeed(await fetchText(source.url!)).map((i) => ({
        ...i,
        // Descriptions start with "[Company]"; the publisher is stored separately.
        summary: i.summary.replace(/^\[[^\]]*\]\s*/, ""),
      })),
  },
  google_news_rss: {
    sourceType: "google_news",
    fetchItems: async (source, fetchText) => {
      const items: RawItem[] = []
      for (const { q } of source.queries ?? []) {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`
        for (const i of fromFeed(await fetchText(url))) {
          // Titles are "Headline - Publisher".
          const suffix = i.publisher ? ` - ${i.publisher}` : ""
          items.push({
            ...i,
            title:
              suffix && i.title.endsWith(suffix)
                ? i.title.slice(0, -suffix.length)
                : i.title,
          })
        }
      }
      return items
    },
  },
  prtimes_search: {
    sourceType: "prtimes",
    fetchItems: async (source, fetchText, ctx) => {
      // 1) newest results per query (one page each)
      const hits = new Map<string, { title: string; company: string | null }>()
      for (const { q } of source.queries ?? []) {
        for (const h of parseSearch(await fetchText(searchUrl(q))))
          if (!hits.has(h.url)) hits.set(h.url, h)
      }
      const fresh = [...hits].filter(([url]) => !ctx.isKnown(url))
      const candidates = fresh.filter(([, h]) => ctx.isCandidateTitle(h.title))
      const limit = source.maxDetailFetches ?? 30
      // 2) detail pages for new candidates only, capped per run
      const items: RawItem[] = []
      let failed = 0
      for (const [url, h] of candidates.slice(0, limit)) {
        try {
          const r = parseRelease(await fetchText(url))
          if (!r) {
            failed++
            continue
          }
          items.push({
            url,
            title: r.title,
            summary: r.body,
            publisher: r.publisher ?? h.company,
            publishedAt: r.publishedAt,
          })
        } catch (e) {
          // Access restricted: stop immediately instead of retrying other pages.
          if (e instanceof BlockedError) throw e
          failed++
          ctx.log(`詳細取得失敗 ${url}: ${(e as Error).message}`)
        }
      }
      ctx.log(
        `検索ヒット${hits.size}件 / 未取得${fresh.length}件 / 候補${candidates.length}件 / 詳細取得${items.length}件` +
          (failed ? ` / 失敗${failed}件` : "") +
          (candidates.length > limit
            ? ` / 次回へ繰越${candidates.length - limit}件`
            : "")
      )
      return items
    },
  },
}
