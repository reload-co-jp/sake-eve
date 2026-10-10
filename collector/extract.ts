/**
 * Rule-based field extraction from a title + short summary.
 * Principle: never guess. Anything not stated explicitly stays null.
 */
import { PREFECTURES, type EventType, type Genre } from "../lib/types.ts"

export type KeywordConfig = {
  /** false = any alcohol-related item becomes a candidate (still needs approval). */
  requireEventKeyword?: boolean
  genreKeywords: Record<Genre, string[]>
  eventKeywords: string[]
  eventTypeKeywords: Partial<Record<EventType, string[]>>
}

export type Extracted = {
  genres: Genre[]
  eventTypes: EventType[]
  startDate: string | null // YYYY-MM-DD
  endDate: string | null
  /** Where the date was found: a labelled field ("日時：…") or anywhere in the text. */
  dateSource: "label" | "text" | null
  venueName: string | null
  address: string | null
  prefecture: string | null
  city: string | null
  officialUrl: string | null
}

const includesAny = (text: string, words: string[]) =>
  words.some((w) => text.includes(w))

const pad = (n: string) => n.padStart(2, "0")
const ymd = (y: string, m: string, d: string) => {
  const s = `${y}-${pad(m)}-${pad(d)}`
  const t = new Date(`${s}T00:00:00Z`)
  // Reject impossible dates such as 2月30日.
  return !isNaN(t.getTime()) && t.toISOString().startsWith(s) ? s : null
}

// "2026年10月17日(土)〜18日(日)", "2026年10月17日～2026年11月3日", "2026/10/17-10/18"
const DATE_RE =
  /(\d{4})\s*[年/.]\s*(\d{1,2})\s*[月/.]\s*(\d{1,2})\s*日?(?:\s*[(（][^)）]{1,6}[)）])?(?:\s*\d{1,2}:\d{2})?(?:\s*[~〜\-–－]\s*(?:(\d{4})\s*[年/.]\s*)?(?:(\d{1,2})\s*[月/.]\s*)?(\d{1,2})\s*日?(?![\d:時分]))?/

const findDate = (text: string) => {
  const m = text.match(DATE_RE)
  if (!m) return null
  const [, y, mo, d, y2, mo2, d2] = m
  const start = ymd(y, mo, d)
  if (!start) return null
  let end: string | null = null
  if (d2) {
    end = ymd(y2 ?? y, mo2 ?? mo, d2)
    // "12月30日〜1月2日" without a year is ambiguous: leave the end unknown.
    if (end && end < start) end = null
  }
  return { start, end: end ?? start, index: m.index! }
}

const COMPANY_BLOCK =
  /[【■●◆<＜[]?\s*(?:会社概要|企業概要|団体概要|法人概要|会社情報|本件に関する(?:お)?問い?合わせ|お問い?合わせ先)/

const LABEL_DATE_RE = /(?:日時|日程|開催日|開催期間|期間|会期)\s*[:：]?\s*/g

const labelled = (text: string, labels: string) => {
  const m = text.match(
    new RegExp(`(?:${labels})\\s*[:：]\\s*([^\\n。、【】\\[\\]]{2,60})`)
  )
  return m ? m[1].replace(/[\s(（]+$/, "").trim() : null
}

const prefectureIn = (s: string | null) => {
  if (!s) return null
  const found = new Set(PREFECTURES.filter((p) => s.includes(p)))
  return found.size === 1 ? [...found][0] : null
}

export const hasEventKeyword = (text: string, cfg: KeywordConfig) =>
  includesAny(text, cfg.eventKeywords)

export const isRelevant = (text: string, cfg: KeywordConfig) =>
  Object.values(cfg.genreKeywords).some((ws) => includesAny(text, ws)) &&
  (cfg.requireEventKeyword === false || hasEventKeyword(text, cfg))

export const extract = (
  title: string,
  summary: string,
  cfg: KeywordConfig
): Extracted => {
  // Company profile / contact blocks at the end of releases carry the HQ address,
  // which must never be read as the venue.
  const body = summary.normalize("NFKC").split(COMPANY_BLOCK)[0]
  const text = `${title}\n${body}`.normalize("NFKC")

  // Genres from the title when it names one; long bodies mention many drinks in passing.
  const specificIn = (s: string) =>
    (Object.keys(cfg.genreKeywords) as Genre[]).filter(
      (g) => g !== "other" && includesAny(s, cfg.genreKeywords[g])
    )
  const fromTitle = specificIn(title.normalize("NFKC"))
  const specific = fromTitle.length ? fromTitle : specificIn(text)
  const genres: Genre[] = specific.length ? specific : ["other"]
  const types = (Object.keys(cfg.eventTypeKeywords) as EventType[]).filter(
    (t) => includesAny(text, cfg.eventTypeKeywords[t] ?? [])
  )

  // Prefer a date right after a label such as "日時："; otherwise the first explicit date.
  let date: ReturnType<typeof findDate> = null
  let dateSource: Extracted["dateSource"] = null
  for (const m of text.matchAll(LABEL_DATE_RE)) {
    const d = findDate(
      text.slice(m.index! + m[0].length, m.index! + m[0].length + 40)
    )
    if (d && d.index === 0) {
      date = d
      dateSource = "label"
      break
    }
  }
  if (!date) {
    date = findDate(text)
    if (date) dateSource = "text"
  }

  const venueName = labelled(text, "会場|場所|開催場所")
  const address = labelled(text, "住所|所在地")
  // Only trust prefectures stated for the venue/address or in the title,
  // never the company headquarters that press releases routinely mention.
  const prefecture =
    prefectureIn(venueName) ??
    prefectureIn(address) ??
    prefectureIn(title.normalize("NFKC"))
  const city =
    address && prefecture && prefectureIn(address) === prefecture
      ? (address.split(prefecture)[1]?.match(/^\s*(\S+?[市区町村郡])/)?.[1] ??
        null)
      : null
  const officialUrl =
    text.match(
      /(?:公式(?:サイト|HP|ホームページ)|特設サイト|詳細|URL)\s*[:：]?\s*(https?:\/\/[^\s<>"）)]+)/
    )?.[1] ?? null

  return {
    genres,
    eventTypes: types.length ? types : ["other"],
    startDate: date?.start ?? null,
    endDate: date?.end ?? null,
    dateSource,
    venueName,
    address,
    prefecture,
    city,
    officialUrl,
  }
}
