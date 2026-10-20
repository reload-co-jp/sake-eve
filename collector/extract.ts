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

// Year omitted: "10月17日(土)〜18日(日)", "10/17(土)、18(日)" (slash form needs a weekday).
const MD_RE =
  /(?<![\d年/.])(\d{1,2})\s*(?:月\s*(\d{1,2})\s*日|\/\s*(\d{1,2})(?=\s*[(（]))(?:\s*[(（][^)）]{1,6}[)）])?(?:\s*\d{1,2}:\d{2})?(?:\s*[~〜\-–－・、]\s*(?:(\d{1,2})\s*[月/]\s*)?(\d{1,2})\s*日?(?![\d:時分/]))?/

/** Year for a month/day stated without one: the publish year, or the next if that would be 3+ months past. */
const inferYear = (mo: string, d: string, ref: string) => {
  const y = Number(ref.slice(0, 4))
  const s = ymd(String(y), mo, d)
  const past = s && Date.parse(ref) - Date.parse(s) > 90 * 864e5
  return String(past ? y + 1 : y)
}

const findDate = (text: string, ref: string | null, onlyMonthDay = false) => {
  const full = onlyMonthDay ? null : text.match(DATE_RE)
  const md = ref ? text.match(MD_RE) : null
  let y, mo, d, y2, mo2, d2
  let m: RegExpMatchArray
  if (full && (!md || full.index! <= md.index!)) {
    m = full
    ;[, y, mo, d, y2, mo2, d2] = full
  } else if (md) {
    m = md
    ;[, mo, d] = md
    d ??= md[3]
    ;[mo2, d2] = [md[4], md[5]]
    y = inferYear(mo, d, ref!)
  } else return null
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

const LABEL_DATE_RE = /(?:日時|日程|開催日|開催期間|期間|会期)】?\s*[:：]?\s*/g

// PR TIMES pages carry the release timestamp ("2026年10月9日 20時00分") near the top.
const RELEASE_STAMP = /\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}時\d{2}分/g

// "会場：…" or "【開催場所】…"
const labelled = (text: string, labels: string) => {
  const m = text.match(
    new RegExp(
      `(?:(?:${labels})\\s*[:：]|【[^】\\n]{0,4}(?:${labels})】)\\s*([^\\n。、【】\\[\\]]{2,60})`
    )
  )
  return m ? m[1].replace(/[\s(（]+$/, "").trim() : null
}

// Unambiguous place names that imply a prefecture: 東京 and the designated cities.
// ponytail: fixed list; add cities here when reviews keep filling the same prefecture.
const ALIASES: [string, (typeof PREFECTURES)[number]][] = [
  ["東京", "東京都"],
  ["札幌", "北海道"],
  ["仙台", "宮城県"],
  ["さいたま", "埼玉県"],
  ["千葉", "千葉県"],
  ["横浜", "神奈川県"],
  ["川崎", "神奈川県"],
  ["相模原", "神奈川県"],
  ["新潟", "新潟県"],
  ["静岡", "静岡県"],
  ["浜松", "静岡県"],
  ["名古屋", "愛知県"],
  ["京都", "京都府"],
  ["大阪", "大阪府"],
  ["堺市", "大阪府"],
  ["神戸", "兵庫県"],
  ["岡山", "岡山県"],
  ["広島", "広島県"],
  ["北九州", "福岡県"],
  ["福岡", "福岡県"],
  ["熊本", "熊本県"],
]
// "東京都" contains "京都"; "川崎氏" is a person.
const ALIAS_RE = ALIASES.map(
  ([a, p]) => [new RegExp(`(?<!東)${a}(?!氏|さん|様)`), p] as const
)

const prefectureIn = (s: string | null) => {
  if (!s) return null
  const found = new Set(PREFECTURES.filter((p) => s.includes(p)))
  if (!found.size) for (const [re, p] of ALIAS_RE) if (re.test(s)) found.add(p)
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
  cfg: KeywordConfig,
  /** Publish time; lets dates without a year be read in its year. */
  publishedAt: string | null = null
): Extracted => {
  // Company profile / contact blocks at the end of releases carry the HQ address,
  // which must never be read as the venue.
  const body = summary
    .normalize("NFKC")
    .split(COMPANY_BLOCK)[0]
    .replace(RELEASE_STAMP, "")
  const text = `${title}\n${body}`
    .normalize("NFKC")
    .replace(/令和\s*(\d{1,2})\s*年/g, (_, n) => `${2018 + Number(n)}年`)
  const ref = publishedAt
    ? new Date(Date.parse(publishedAt) + 9 * 3600e3).toISOString()
    : null

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
      text.slice(m.index! + m[0].length, m.index! + m[0].length + 40),
      ref
    )
    if (d && d.index === 0) {
      date = d
      dateSource = "label"
      break
    }
  }
  if (!date) {
    date = findDate(text, ref)
    if (date) {
      dateSource = "text"
      // A date equal to the release day is the article's own date: a month/day
      // mention ("10月23日") is more likely the event date.
      if (ref && date.start === ref.slice(0, 10)) {
        const monthDay = findDate(text, ref, true)
        if (monthDay) date = monthDay
      }
    }
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
