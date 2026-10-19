/**
 * Find the official site of published events that have no `officialUrl`.
 *
 * Only what the sources state is used: the links inside the source pages
 * (PR TIMES releases, news articles) are collected, then each candidate is
 * fetched and checked against the event (name, place, year). Nothing is
 * guessed and nothing is written unless a candidate passes the check.
 *
 *   node collector/official-urls.ts              # report only
 *   node collector/official-urls.ts --apply      # write data/events.json
 *   node collector/official-urls.ts --only evt-xxx
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { isAllowed, parseRobots } from "./http.ts"
import { loadDb, writeJson } from "./store.ts"
import type { Event } from "../lib/types.ts"

const ROOT = join(import.meta.dirname, "..")
const CONF = JSON.parse(readFileSync(join(ROOT, "collector/config.json"), "utf8"))

// ---------------------------------------------------------------- fetching

type Robots = ReturnType<typeof parseRobots>

/** robots.txt compliant client: one request per host at a time, never retries a block. */
class Polite {
  private robots = new Map<string, Promise<Robots>>()
  private last = new Map<string, number>()
  private ua: string
  private intervalMs: number
  private timeoutMs: number
  constructor(ua: string, intervalMs: number, timeoutMs: number) {
    this.ua = ua
    this.intervalMs = intervalMs
    this.timeoutMs = timeoutMs
  }

  private async rules(origin: string): Promise<Robots> {
    let r = this.robots.get(origin)
    if (!r) {
      r = (async () => {
        try {
          const res = await fetch(`${origin}/robots.txt`, {
            headers: { "User-Agent": this.ua },
            signal: AbortSignal.timeout(this.timeoutMs),
          })
          if (res.ok) return parseRobots(await res.text())
          // A missing robots.txt means no restrictions; a server error means stay away.
          return res.status >= 500
            ? [{ allow: false, pattern: "/" }]
            : []
        } catch {
          return []
        }
      })()
      this.robots.set(origin, r)
    }
    return r
  }

  async get(
    url: string
  ): Promise<{ url: string; status: number; text: string } | null> {
    const u = new URL(url)
    if (!isAllowed(await this.rules(u.origin), u.pathname + u.search))
      return null
    const wait = (this.last.get(u.host) ?? 0) + this.intervalMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.last.set(u.host, Date.now())
    try {
      const res = await fetch(u, {
        headers: { "User-Agent": this.ua },
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (res.status === 403 || res.status === 429) return null
      if (!res.ok) return null
      const buf = new Uint8Array(await res.arrayBuffer())
      const ct = res.headers.get("content-type")
      const head = new TextDecoder("latin1").decode(buf.slice(0, 2048))
      const label =
        ct?.match(/charset=["']?([\w-]+)/i)?.[1] ??
        head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
        "utf-8"
      let text: string
      try {
        text = new TextDecoder(label).decode(buf)
      } catch {
        text = new TextDecoder("utf-8").decode(buf)
      }
      return { url: res.url, status: res.status, text }
    } catch {
      return null
    }
  }
}

// ------------------------------------------------------------------ helpers

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[e]!
    )

const stripTags = (html: string) =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/** Hostname as written (www included): needed to fetch the site. */
const rawHostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

/** Ticket and reservation platforms: not the official site of the event. */
const TICKET_HOSTS = [
  "eplus.jp",
  "peatix.com",
  "l-tike.com",
  "eventvol.com",
  "compas.live",
  "toast-tab.com",
  "eventbrite.jp",
  "pia.jp",
  "tickets",
  "ticket",
  "showtie",
  "eventive",
  "rodil",
  "mrbale",
  "getlink",
  "l-tike",
  "fanfan",
  "honto",
  "survival",
]
const isTicketHost = (url: string) => {
  const h = hostOf(url)
  return TICKET_HOSTS.some((t) => h.includes(t))
}

/** Hosts that never are the official site of an event. */
const JUNK_HOSTS = [
  "prtimes.jp",
  "tayori.com",
  "jooto.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "linkedin.com",
  "note.com",
  "pinterest.com",
  "threads.net",
  "line.me",
  "forms.gle",
  "google.com",
  "google.co.jp",
  "googleapis.com",
  "amazon.co.jp",
  "amazon.com",
  "rakuten.co.jp",
  "shopping.yahoo.co.jp",
  "paypay.ne.jp",
  "hatena.ne.jp",
  "b.hatena.ne.jp",
  "fc2.com",
  "blogspot.com",
  "livedoor.jp",
  "ameblo.jp",
  "pixiv.net",
  "rumble.com",
  "nicovideo.jp",
  "suzuri.jp",
  "mapion.co.jp",
  "goo.gl",
  "prcdn.freetls.fastly.net",
  "sites.google.com",
  "my.ebook5.net",
  "issuu.com",
  "speakerdeck.com",
  "slideshare.net",
  "prtimes.jp.main",
]
const isJunk = (url: string) => {
  const h = hostOf(url)
  if (!h) return true
  if (JUNK_HOSTS.some((j) => h === j || h.endsWith(`.${j}`))) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return true
  return false
}

/** Anchor text that points at the event's own page. */
const OFFICIAL_WORDS = [
  "公式",
  "特設",
  "イベントサイト",
  "イベントページ",
  "イベント詳細",
  "公式サイト",
  "開催サイト",
  "詳細ページ",
  "公式ホームページ",
  "ホームページ",
  "もっと詳しく",
  "further information",
  "more information",
]
/** Anchor text that points at something else than the event page. */
const NEGATIVE_WORDS = [
  "料金",
  "チケット",
  "予約",
  "申込",
  "駐輪",
  "アクセス",
  "地図",
  "案内",
  "お問い合わせ",
  "会社",
  "採用",
  "求人",
  "メニュー",
  "menu",
  "menu",
  "corporate",
  "採用情報",
  "会社情報",
  "乘车",
  "駐車場",
  "faq",
  "privacy",
  "特定商取引法",
  "プライバシーポリシー",
  "お問い合わせフォーム",
]
/** Anchor text that points at a ticket/reservation page, not the official site. */
const TICKET_WORDS = [
  "チケット",
  "予約",
  "申込",
  "peatix",
  "toast",
  "compas",
  "rocket",
  "eventticket",
  "eplus",
  "pia",
]
/** Anchor text that points at the company, not the event. */
const COMPANY_WORDS = [
  "会社概要",
  "企業",
  "会社",
  "corporate",
  "採用",
  "募集",
  "お問い合わせ",
  "取材",
  "ログイン",
  "facebook",
  "twitter",
  "instagram",
  "youtube",
  "地図",
  "アクセス",
  "店舗情報",
]

type Link = {
  href: string
  text: string
  kind: "related" | "official" | "url" | "ticket"
  /** Position in the page, used to drop the company footer. */
  at: number
}

/** Anchors of the page body (PR TIMES: inside <article>; else <main>; else the page). */
const linksOf = (html: string): Link[] => {
  let scope = html
  const start = html.indexOf("<article")
  const end = html.lastIndexOf("</article>")
  if (start >= 0 && end > start) scope = html.slice(start, end)
  else {
    const m = html.indexOf("<main")
    if (m >= 0) {
      const e = html.indexOf("</main>", m)
      if (e > m) scope = html.slice(m, e)
    }
  }
  const out: Link[] = []
  for (const m of scope.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1]
    const href =
      attrs.match(/href=["']([^"']+)["']/i)?.[1] ??
      attrs.match(/href=([^\s>]+)/i)?.[1]
    if (!href) continue
    const text = stripTags(m[2])
    out.push({ href, text, kind: "url", at: m.index! })
  }
  return out
}

/** PR TIMES keeps the event links in a "関連リンク" row; those are the strongest hint. */
const relatedLinkUrls = (html: string): Set<string> => {
  const out = new Set<string>()
  for (const m of html.matchAll(
    /(?:関連リンク|関連情報|мирrors?|関連サイト)[\s\S]{0,400}?<\/dt>([\s\S]{0,2000}?)<\/dd>/gi
  )) {
    for (const a of m[1].matchAll(/href=["'](https?:\/\/[^"']+)["']/gi))
      out.add(a[1])
  }
  return out
}

/** Press releases repeat the company footer; links from there are the company, not the event. */
const COMPANY_BLOCK_RE =
  /(?:<strong>\s*)?(?:<u>\s*)?(?:会社概要|企業概要|団体概要|法人概要|会社情報)(?:<\/u>|<\/strong>)?\s*(?:<[^>]+>\s*)*(?:<br|<p|<div)/

const normalizeUrl = (u: string) => {
  try {
    const p = new URL(u)
    p.hash = ""
    for (const k of [...p.searchParams.keys()])
      if (/^utm_|^ref$|^from$/i.test(k)) p.searchParams.delete(k)
    let s = p.toString()
    if (s.endsWith("/") && p.pathname !== "/") s = s.slice(0, -1)
    return s
  } catch {
    return u
  }
}

// ------------------------------------------------------------- text checks

/** Normalised text for matching: no spaces, no punctuation. */
const flat = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .replace(
      /[・,，.。:：;；!！?？()（）「」『』【】[\]<>＞《》\-–—~〜+＝=＆&'"/|_*#@$%^]/g,
      ""
    )

const STOP = new Set([
  "イベント",
  "フェス",
  "フェスティバル",
  "まつり",
  "祭",
  "開催",
  "特別",
  "第",
  "回",
  "in",
  "the",
  "vol",
  "年",
  "月",
  "日",
  "日程",
  "会場",
  "主催",
  "共催",
  "より",
  "など",
  "入場",
  "無料",
  "予約",
  "受付中",
  "開催決定",
  "決定",
  "本日",
  "開催中",
  "終了",
  "開始",
  "abil",
])

/** Distinctive words of the event name (series and place names). */
const keywordsOf = (title: string): string[] => {
  const parts = title
    .normalize("NFKC")
    .split(
      /[\s\u3000「」『』【】()（）・,，.。:：;；!！?？~〜+／/&＆|｜\-–—"'“”\u3000]+/
    )
    .filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    // Years and edition numbers are not distinctive.
    const w = p.replace(/20\d{2}/g, "").replace(/第\d+回$/, "").trim()
    if (!w || STOP.has(w.toLowerCase())) continue
    if (/^\d+$/.test(w)) continue
    if (w.length < 2) continue
    out.push(w)
  }
  return [...new Set(out)]
}

/** Place words of the title: "… in 神戸" and similar. */
const placeWords = (title: string): string[] => {
  const m = title.match(/\bin\s+([^\s（「(]+)/i)
  if (!m) return []
  return keywordsOf(m[1])
}

/** Name words that are not the venue: the series name must be on the page. */
const coreTokens = (event: Event): string[] => {
  const venue = [
    event.venue.name,
    event.venue.city,
    event.venue.prefecture,
  ]
    .filter(Boolean)
    .join(" ")
  const f = flat(venue)
  return keywordsOf(event.title).filter((w) => {
    const x = flat(w)
    return x && !f.includes(x)
  })
}

const yearsIn = (text: string) =>
  new Set([...text.matchAll(/\b(20\d{2})\b/g)].map((m) => m[1]))

/** Page title, og:title and headings: where the event name belongs. */
const headTextOf = (html: string) => {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
  const og =
    html.match(
      /<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*content=["']([^"']*)["']/i
    )?.[1] ??
    html.match(
      /<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["'](?:og:title|twitter:title)["']/i
    )?.[1] ??
    ""
  const h1 = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((m) => stripTags(m[1]))
    .join(" ")
  return [title, og, h1].filter(Boolean).join(" ")
}

type Check = { ok: boolean; reason: string; score: number }

/** Does the fetched page look like the page of this event? */
const checkPage = (
  event: Event,
  page: { url: string; text: string; head: string },
  nameParts: string[],
  placeParts: string[]
): Check => {
  const head = flat(page.head)
  const body = flat(page.text)
  // The series name (not the venue) has to be in the title of the page.
  const core = coreTokens(event)
  const inHead = core.filter((w) => head.includes(flat(w)))
  const inBody = core.filter((w) => body.includes(flat(w)))
  const matched = inHead.length ? inHead : inBody
  if (!matched.length)
    return { ok: false, reason: "イベント名が見つからない", score: 0 }
  // The place of a series event ("… in 神戸") must be on the page as well.
  const missingPlace = placeParts.filter((w) => !body.includes(flat(w)))
  // A page about a different edition (2025 instead of 2026) is not this event.
  const year = event.startAt
    ? new Date(Date.parse(event.startAt) + 9 * 3600e3).getUTCFullYear()
    : null
  const years = yearsIn(page.text)
  const wrongYear =
    year !== null && years.size > 0 && !years.has(String(year))
  const score =
    matched.reduce((s, w) => s + Math.min(w.length, 8), 0) +
    (inHead.length ? 15 : 0) +
    (missingPlace.length ? -20 : 10) +
    (wrongYear ? -30 : 5)
  const ok =
    matched.some((w) => w.length >= 3 || /[ァ-ヶ一-龠]/.test(w)) &&
    missingPlace.length === 0 &&
    !wrongYear &&
    inHead.length > 0
  return {
    ok,
    reason: ok
      ? `一致（${matched.join("・")}）`
      : [
          inHead.length ? "" : "タイトルにイベント名なし",
          missingPlace.length ? `地名不足(${missingPlace.join("・")})` : "",
          wrongYear ? "年不一致" : "",
        ]
          .filter(Boolean)
          .join("・") || "一致不足",
    score,
  }
}

// --------------------------------------------------------------- candidates

/** Links inside the source pages that could be the event's own site. */
const candidatesOf = (html: string, sourceUrl: string): Link[] => {
  const srcHost = hostOf(sourceUrl)
  const related = relatedLinkUrls(html)
  const companyAt = html.search(COMPANY_BLOCK_RE)
  const out = new Map<string, Link>()
  for (const l of linksOf(html)) {
    const href = l.href.trim()
    if (!/^https?:\/\//i.test(href)) continue
    const abs = new URL(href, sourceUrl).toString()
    if (isJunk(abs)) continue
    if (hostOf(abs) === srcHost) continue
    const lower = l.text.toLowerCase()
    const isRelated = related.has(abs) || related.has(normalizeUrl(abs))
    const official = OFFICIAL_WORDS.some((w) => lower.includes(w))
    const ticket = TICKET_WORDS.some((w) => lower.includes(w))
    const company = COMPANY_WORDS.some((w) => lower.includes(w))
    const negative = NEGATIVE_WORDS.some((w) => lower.includes(w))
    const bare = /^https?:\/\//i.test(l.text.trim())
    // Links below the company footer describe the company, not the event.
    if (!isRelated && companyAt >= 0 && l.at > companyAt) continue
    if (!isRelated && !official && !bare) continue
    if (!isRelated && !official && ticket) continue
    if (!isRelated && company) continue
    if (!isRelated && official && negative) continue
    if (!isRelated && bare && negative) continue
    const key = normalizeUrl(abs)
    if (!out.has(key))
      out.set(key, {
        href: abs,
        text: l.text,
        kind: isTicketHost(abs)
          ? "ticket"
          : isRelated
            ? "related"
            : official
              ? "official"
              : "url",
        at: l.at,
      })
  }
  // Releases sometimes write the URL as plain text instead of a link.
  for (const m of stripTags(html).matchAll(/https?:\/\/[^\s"'）)]+/g)) {
    const abs = m[0].replace(/[.,;、。]$/, "")
    if (isJunk(abs)) continue
    if (hostOf(abs) === srcHost) continue
    const key = normalizeUrl(abs)
    if (!out.has(key))
      out.set(key, {
        href: abs,
        text: "",
        kind: related.has(abs) ? "related" : "url",
        at: 0,
      })
  }
  return [...out.values()]
}

/** Every host linked from the source page: the organiser or venue site to search. */
const siteRootsOf = (html: string, sourceUrl: string): string[] => {
  const srcHost = hostOf(sourceUrl)
  const related = relatedLinkUrls(html)
  const seen: string[] = []
  for (const l of linksOf(html)) {
    if (!/^https?:\/\//i.test(l.href.trim())) continue
    const abs = new URL(l.href.trim(), sourceUrl).toString()
    if (isJunk(abs)) continue
    const h = rawHostOf(abs)
    if (hostOf(abs) === srcHost || seen.includes(h)) continue
    seen.push(h)
  }
  // Hosts of the release's own related links come first.
  return seen.sort((a, b) => {
    const ra = [...related].some((u) => rawHostOf(u) === a) ? 0 : 1
    const rb = [...related].some((u) => rawHostOf(u) === b) ? 0 : 1
    return ra - rb
  })
}

/** Does the link text or its URL look like this event? */
const mentionsEvent = (text: string, href: string, parts: string[]) => {
  const t = flat(text)
  const h = flat(href)
  for (const p of parts) {
    const f = flat(p)
    if (f.length < 4) continue
    if (t.includes(f)) return true
    // Link texts are often truncated ("京都駅ビルビア…").
    if (f.length >= 8 && t.includes(f.slice(0, 6))) return true
    // Japanese titles are romanised in URLs.
    const latin = p.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (latin.length >= 5 && h.includes(latin)) return true
  }
  return false
}

// ------------------------------------------------------------------- main

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const onlyIdx = args.indexOf("--only")
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null
/** Editor-chosen candidates: { id, url } — verified with the same checks. */
const candIdx = args.indexOf("--candidates")
const candFile = candIdx >= 0 ? args[candIdx + 1] : null

const db = loadDb(join(ROOT, "data"))
const sources = new Map(db.sources.map((s) => [s.id, s]))
const targets = db.events.filter(
  (e) =>
    e.publication === "published" &&
    !e.officialUrl &&
    !e.isSample &&
    (!only || e.id === only)
)

const client = new Polite(
  CONF.userAgent,
  CONF.requestIntervalMs,
  CONF.timeoutMs
)

/** Editor-chosen candidates: { id, url, checked? } per line. */
const manual = new Map<
  string,
  { url: string; checked: boolean }[]
>()
if (candFile) {
  const raw = JSON.parse(readFileSync(candFile, "utf8")) as {
    id: string
    url: string
    checked?: boolean
  }[]
  for (const c of raw)
    manual.set(c.id, [
      ...(manual.get(c.id) ?? []),
      { url: c.url, checked: c.checked === true },
    ])
}

type Result = {
  id: string
  title: string
  status: "found" | "no-candidate" | "unverified"
  url: string | null
  reason: string
  candidates: { url: string; text: string; kind: string; reason: string }[]
}

/** An article page is a news post, not the official site of the event. */
const ARTICLE_PATH =
  /\/(blog|blogs|news|magazine|article|articles|press|pr|pressrelease|entry|entries|topics|column|report)\b/i
/** A dedicated event site usually has the event name in the path or the host. */
const rankOf = (url: string, kind: Link["kind"], title: string) => {
  let rank = kind === "related" ? 40 : kind === "official" ? 25 : 10
  if (ARTICLE_PATH.test(new URL(url).pathname)) rank -= 20
  const host = hostOf(url)
  const path = new URL(url).pathname.toLowerCase()
  for (const w of keywordsOf(title)) {
    const latin = w.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (latin.length < 4) continue
    if (host.includes(latin) || path.includes(latin)) rank += 15
  }
  return rank
}

const results: Result[] = []

/** Fetch a candidate and judge it. */
const verify = async (
  event: Event,
  nameParts: string[],
  placeParts: string[],
  c: Link
): Promise<{ url: string; check: Check } | null> => {
  const fetched = await client.get(c.href)
  if (!fetched) return null
  const body = stripTags(fetched.text).slice(0, 20000)
  const check = checkPage(
    event,
    { url: fetched.url, text: body, head: headTextOf(fetched.text) },
    nameParts,
    placeParts
  )
  return { url: normalizeUrl(fetched.url), check }
}

for (const event of targets) {
  const nameParts = keywordsOf(event.title)
  const placeParts = placeWords(event.title)
  const candidates: Result["candidates"] = []
  const seen = new Set<string>()
  let best: { url: string; score: number; reason: string } | null = null

  // Editor-chosen candidates replace the automatic search.
  if (manual.has(event.id)) {
    for (const c of manual.get(event.id)!) {
      const v = await verify(event, nameParts, placeParts, {
        href: c.url,
        text: "",
        kind: "official",
        at: 0,
      })
      candidates.push({
        url: v?.url ?? c.url,
        text: "",
        kind: "manual",
        reason: v ? v.check.reason : "取得できない",
      })
      if (!v) continue
      // "checked" candidates were verified by hand (the automatic check is a
      // help, not the judge: the event name may be written differently).
      if (!v.check.ok && !c.checked) continue
      best = {
        url: v.url,
        score: v.check.score + rankOf(v.url, "official", event.title),
        reason: v.check.reason + (c.checked ? "（手動確認済み）" : ""),
      }
    }
    const m: Result = {
      id: event.id,
      title: event.title,
      status: best ? "found" : candidates.length ? "unverified" : "no-candidate",
      url: best?.url ?? null,
      reason: best?.reason ?? "候補なし",
      candidates,
    }
    results.push(m)
    console.log(
      `${m.status === "found" ? "OK  " : "--  "}${event.title}\n     ${
        m.url ?? m.reason
      }`
    )
    continue
  }

  // With a candidate file only the listed events are processed.
  if (candFile) continue

  const consider = async (c: Link) => {
    const key = normalizeUrl(c.href)
    if (seen.has(key)) return
    seen.add(key)
    const v = await verify(event, nameParts, placeParts, c)
    if (!v) {
      candidates.push({
        url: key,
        text: c.text,
        kind: c.kind,
        reason: "取得できない",
      })
      return
    }
    candidates.push({
      url: v.url,
      text: c.text,
      kind: c.kind,
      reason: v.check.reason,
    })
    if (!v.check.ok) return
    // A ticket platform is not the official site of the event.
    if (c.kind === "ticket" || isTicketHost(v.url)) return
    const score = v.check.score + rankOf(v.url, c.kind, event.title)
    if (!best || score > best.score)
      best = { url: v.url, score, reason: v.check.reason }
  }

  // Phase 1: the links the source itself gives.
  const sourcePages: { html: string; url: string }[] = []
  for (const sid of event.sourceIds) {
    const source = sources.get(sid)
    if (!source) continue
    const page = await client.get(source.url)
    if (!page) continue
    sourcePages.push({ html: page.text, url: source.url })
    for (const c of candidatesOf(page.text, source.url)) await consider(c)
  }

  // Phase 2: the organiser or venue site linked by the source may list the event.
  if (!best) {
    const roots = [...new Set(sourcePages.flatMap((p) => siteRootsOf(p.html, p.url)))]
      .filter((h) => !isJunk(`https://${h}/`))
      .slice(0, 4)
    for (const root of roots) {
      const home = await client.get(`https://${root}/`)
      if (!home) continue
      for (const l of linksOf(home.text)) {
        const abs = new URL(l.href.trim(), home.url).toString()
        if (!/^https?:\/\//i.test(abs)) continue
        if (isJunk(abs) || hostOf(abs) !== hostOf(`https://${root}/`)) continue
        if (isTicketHost(abs)) continue
        if (!mentionsEvent(l.text, abs, nameParts)) continue
        await consider({
          href: abs,
          text: l.text,
          kind: "url",
          at: l.at,
        })
        if (best) break
      }
      if (best) break
    }
  }

  const r: Result = {
    id: event.id,
    title: event.title,
    status: best ? "found" : candidates.length ? "unverified" : "no-candidate",
    url: best?.url ?? null,
    reason: best?.reason ?? "候補なし",
    candidates,
  }
  results.push(r)
  console.log(
    `${r.status === "found" ? "OK  " : "--  "}${event.title}\n     ${
      r.url ?? r.reason
    }${
      r.status !== "found" && r.candidates.length
        ? `\n     候補: ${r.candidates
            .map((c) => `${c.url} (${c.reason})`)
            .join("\n           ")}`
        : ""
    }`
  )
}

if (apply) {
  const byId = new Map(results.filter((r) => r.url).map((r) => [r.id, r]))
  const now = new Date().toISOString()
  const events = db.events.map((e) => {
    const r = byId.get(e.id)
    if (!r?.url) return e
    return { ...e, officialUrl: r.url, updatedAt: now }
  })
  const next = { ...db, events }
  const { validateDb } = await import("../lib/validate.ts")
  const errors = validateDb(next as never)
  if (errors.length) {
    console.error("検証エラー:", errors)
    process.exit(1)
  }
  writeJson(join(ROOT, "data/events.json"), events)
  console.log(`\n${byId.size}件を data/events.json に書き込みました`)
} else {
  writeJson("/tmp/official-urls-report.json", results)
  console.log("\nレポート: /tmp/official-urls-report.json")
}
