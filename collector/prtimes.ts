/** Parsers for PR TIMES search result and release pages (server-rendered HTML). */
import { decode } from "./rss.ts"

const BASE = "https://prtimes.jp"

const text = (html: string) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d|tr|dd|dt|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim()

export type SearchHit = { url: string; title: string; company: string | null }

/** Search results: <article><a href="/main/html/rd/p/…"><h3>title…</h3></a> <a>company</a></article> */
export const parseSearch = (html: string): SearchHit[] =>
  [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)].flatMap(
    ([, body]) => {
      const href = body.match(
        /href="(\/main\/html\/rd\/p\/[^"#?]+\.html)"/
      )?.[1]
      const title = body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]
      if (!href || !title) return []
      const company = body.match(/company_id\/\d+"[^>]*>([\s\S]*?)<\/a>/)?.[1]
      return [
        {
          url: BASE + href,
          title: text(title),
          company: company ? text(company) : null,
        },
      ]
    }
  )

export type Release = {
  title: string
  publishedAt: string | null
  publisher: string | null
  /** Body text for field extraction only; never stored. */
  body: string
}

/** Release page: NewsArticle JSON-LD for title/date/publisher, <article> text for extraction. */
export const parseRelease = (html: string): Release | null => {
  const raw = html.match(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
  )?.[1]
  if (!raw) return null
  let ld: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    ld = (Array.isArray(parsed) ? parsed : [parsed]).find(
      (x) => x?.["@type"] === "NewsArticle"
    )
  } catch {
    return null
  }
  if (!ld || typeof ld.headline !== "string") return null
  // "2026-10-10 11:00:02" is Japan time without an offset.
  const d = typeof ld.datePublished === "string" ? ld.datePublished : ""
  const m = d.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/)
  const author = ld.author as
    { name?: string } | { name?: string }[] | undefined
  const articles = [
    ...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g),
  ].map((x) => x[1])
  const main = articles.sort((a, b) => b.length - a.length)[0] ?? ""
  return {
    title: ld.headline,
    publishedAt: m
      ? `${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}+09:00`
      : null,
    publisher: (Array.isArray(author) ? author[0]?.name : author?.name) ?? null,
    body: text(main).slice(0, 5000),
  }
}

export const searchUrl = (q: string) =>
  `${BASE}/main/action.php?run=html&page=searchkey&search_word=${encodeURIComponent(q)}`
