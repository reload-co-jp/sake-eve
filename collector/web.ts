/**
 * Generic article page parser for URLs an editor imports by hand
 * (e.g. an original news article found via Google News in their own browser).
 */
import { decode } from "./rss.ts"
import type { RawItem } from "./sources.ts"

const meta = (html: string, key: string) => {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i"
  )
  const m = html.match(re)
  return m ? decode(m[1] ?? m[2]).trim() || null : null
}

const toText = (html: string) =>
  decode(
    html
      .replace(
        /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi,
        ""
      )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d|tr|dd|dt|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim()

type Ld = Record<string, unknown>
const flatten = (x: unknown): Ld[] =>
  Array.isArray(x)
    ? x.flatMap(flatten)
    : x && typeof x === "object"
      ? [x as Ld, ...flatten((x as Ld)["@graph"])]
      : []
const isType = (x: Ld, t: string) =>
  [x["@type"]].flat().some((v) => typeof v === "string" && v.endsWith(t))

const jsonLd = (html: string) =>
  [
    ...html.matchAll(
      /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi
    ),
  ].flatMap(([, raw]) => {
    try {
      return flatten(JSON.parse(raw))
    } catch {
      return []
    }
  })

/** "2026-11-14T10:00:00+09:00" -> "2026年11月14日" in Japan time (date part only). */
const jpDate = (s: unknown) => {
  if (typeof s !== "string") return null
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? Date.parse(`${s}T00:00:00+09:00`)
    : Date.parse(s)
  if (isNaN(t)) return null
  const d = new Date(t + 9 * 3600e3)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

const isoOrNull = (s: string | null) => {
  if (!s) return null
  // Offset-less timestamps on Japanese sites are Japan time.
  const local = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)
  const t = Date.parse(local ? `${s.replace(" ", "T")}+09:00` : s)
  return isNaN(t) ? null : new Date(t).toISOString()
}

/**
 * Explicit schema.org Event data is turned into labelled lines ("日時：…", "会場：…")
 * so the shared extractor reads it like any stated field.
 */
export const parseWebPage = (html: string, url: string): RawItem | null => {
  const items = jsonLd(html)
  const article = items.find((x) => isType(x, "Article"))
  const event = items.find((x) => isType(x, "Event"))
  const title =
    (typeof event?.name === "string" && event.name) ||
    (typeof article?.headline === "string" && article.headline) ||
    meta(html, "og:title") ||
    decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim()
  if (!title) return null

  const lines: string[] = []
  if (event) {
    const s = jpDate(event.startDate)
    const e = jpDate(event.endDate)
    if (s) lines.push(`日時：${s}${e && e !== s ? `〜${e}` : ""}`)
    const loc = [event.location].flat()[0] as Ld | undefined
    if (loc && typeof loc.name === "string") lines.push(`会場：${loc.name}`)
    const addr = loc?.address
    const a =
      typeof addr === "string"
        ? addr
        : addr && typeof addr === "object"
          ? ["addressRegion", "addressLocality", "streetAddress"]
              .map((k) => (addr as Ld)[k])
              .filter((v) => typeof v === "string")
              .join("")
          : ""
    if (a) lines.push(`住所：${a}`)
  }

  const main =
    html.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
    html.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
    html.match(/<body[\s\S]*?<\/body>/i)?.[0] ??
    ""
  const author = [article?.author].flat()[0] as Ld | undefined
  const publisher = article?.publisher as Ld | undefined
  return {
    url,
    title: title.trim(),
    summary: [...lines, toText(main)].join("\n").slice(0, 8000),
    publisher:
      meta(html, "og:site_name") ??
      (typeof publisher?.name === "string" ? publisher.name : null) ??
      (typeof author?.name === "string" ? author.name : null),
    publishedAt: isoOrNull(
      (typeof article?.datePublished === "string"
        ? article.datePublished
        : null) ?? meta(html, "article:published_time")
    ),
  }
}
