/** Minimal parser for RSS 2.0 and RSS 1.0 (RDF) feeds. Feeds are small and flat, so no XML library. */

export type FeedItem = {
  title: string
  link: string
  description: string
  publishedAt: string | null
  publisher: string | null
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

export const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#")
        return String.fromCodePoint(
          e[1].toLowerCase() === "x"
            ? parseInt(e.slice(2), 16)
            : Number(e.slice(1))
        )
      return ENTITIES[e.toLowerCase()] ?? m
    })

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()

const tag = (xml: string, name: string) => {
  const m = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)
  )
  return m ? decode(m[1]).trim() : null
}

const toIso = (s: string | null) => {
  if (!s) return null
  const t = Date.parse(s)
  if (isNaN(t)) return null
  // Keep feeds that already carry an offset verbatim; RFC 822 dates become UTC ISO.
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s : new Date(t).toISOString()
}

export const parseFeed = (xml: string): FeedItem[] =>
  [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].flatMap(
    ([, body]) => {
      const title = tag(body, "title")
      const link = tag(body, "link")
      if (!title || !link) return []
      return [
        {
          title,
          link,
          // Descriptions may be entity-encoded HTML: decode, strip tags, decode the text again.
          description: decode(stripTags(tag(body, "description") ?? ""))
            .replace(/[^\S\n]+/g, " ")
            .trim(),
          publishedAt: toIso(tag(body, "pubDate") ?? tag(body, "dc:date")),
          publisher: tag(body, "source") ?? tag(body, "dc:corp"),
        },
      ]
    }
  )
