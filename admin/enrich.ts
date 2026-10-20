/**
 * Fill an event's empty fields from the pages its sources point to.
 *
 * Same rules as the collector: only what the source states is used (the shared
 * extractor, never a guess) and only empty fields are filled — a value the editor
 * entered is never overwritten. Nothing is written to disk here; the caller shows
 * the result and the editor confirms it by saving.
 */
import {
  extract,
  type Extracted,
  type KeywordConfig,
} from "../collector/extract.ts"
import type { FetchText } from "../collector/http.ts"
import { parseDetail, type RawItem } from "../collector/sources.ts"
import { parseWebPage } from "../collector/web.ts"
import type { Event, EventType, Genre, Source } from "../lib/types.ts"
import { checkImportUrl } from "./api.ts"

/** Labels of the fields that can be filled (shown in the admin UI). */
export const FIELD_LABELS = {
  startAt: "日程",
  endAt: "終了日",
  venueName: "会場名",
  address: "住所",
  prefecture: "都道府県",
  city: "市区町村",
  genres: "ジャンル",
  eventTypes: "イベント形式",
  officialUrl: "公式サイトURL",
  imageUrl: "画像URL",
} as const

export type FilledField = keyof typeof FIELD_LABELS

export type EnrichResult = {
  /** The event with the empty fields filled in. */
  event: Event
  /** Fields that were filled. */
  filled: FilledField[]
  /** Cautions the editor should read (e.g. a date taken from free text). */
  notes: string[]
  /** What the extractor found in the sources. */
  extracted: Extracted | null
  /** The pages that were read. */
  pages: { url: string; title: string; publishedAt: string | null }[]
  /** Per-source failures (blocked, unreachable, unparsable). */
  errors: string[]
}

const blank = (v: string | null) => v === null || v.trim() === ""
const hasGenre = (g: Genre[]) => g.some((x) => x !== "other")
const hasType = (t: EventType[]) => t.some((x) => x !== "other")
/** YYYY-MM-DD in JST. */
const jstDay = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10)

/** Sources the admin may fetch: public http(s) pages, never Google News or samples. */
export const isFetchable = (source: Source): boolean => {
  if (source.sourceType === "sample" || source.sourceType === "google_news")
    return false
  return checkImportUrl(source.url) === null
}

/** Parse a source page into text for extraction (PR TIMES aware, generic pages as fallback). */
export const parseSourcePage = (url: string, html: string): RawItem | null =>
  parseDetail(html, url) ?? parseWebPage(html, url)

/** First source that states a value wins. */
const mergeExtracted = (a: Extracted, b: Extracted): Extracted => {
  const dateFromB = !a.startDate && b.startDate
  return {
    genres: hasGenre(a.genres)
      ? a.genres
      : hasGenre(b.genres)
        ? b.genres
        : a.genres,
    eventTypes: hasType(a.eventTypes)
      ? a.eventTypes
      : hasType(b.eventTypes)
        ? b.eventTypes
        : a.eventTypes,
    startDate: a.startDate ?? b.startDate,
    endDate: a.endDate ?? b.endDate,
    dateSource: dateFromB ? b.dateSource : (a.dateSource ?? b.dateSource),
    venueName: a.venueName ?? b.venueName,
    address: a.address ?? b.address,
    prefecture: a.prefecture ?? b.prefecture,
    city: a.city ?? b.city,
    officialUrl: a.officialUrl ?? b.officialUrl,
  }
}

/**
 * Copy what the source states into the event's empty fields.
 * Existing values are kept; the result still has to pass validation on save.
 */
export const fillMissing = (
  event: Event,
  x: Extracted,
  imageUrl: string | null
): { event: Event; filled: FilledField[]; notes: string[] } => {
  const next = structuredClone(event)
  const filled: FilledField[] = []
  const notes: string[] = []

  if (blank(next.startAt) && x.startDate) {
    const start = `${x.startDate}T00:00:00+09:00`
    next.startAt = start
    // endAt without startAt is invalid, so the start day doubles as the end day.
    const fromSource = x.endDate ? `${x.endDate}T23:59:00+09:00` : null
    const kept =
      next.endAt && Date.parse(next.endAt) >= Date.parse(start)
        ? next.endAt
        : null
    next.endAt = kept ?? fromSource ?? start
    // Only the date is known: the time of day would be made up.
    next.dateOnly = true
    filled.push("startAt")
    if (x.dateSource === "text")
      notes.push(
        "日程は本文中の日付です。ラベルの付いた記載か原典で確認してください。"
      )
  } else if (
    !blank(next.startAt) &&
    blank(next.endAt) &&
    x.endDate &&
    Date.parse(`${x.endDate}T23:59:00+09:00`) >= Date.parse(next.startAt)
  ) {
    next.endAt = `${x.endDate}T23:59:00+09:00`
    filled.push("endAt")
  }

  if (blank(next.venue.name) && x.venueName) {
    next.venue.name = x.venueName
    filled.push("venueName")
  }
  if (blank(next.venue.address) && x.address) {
    next.venue.address = x.address
    filled.push("address")
  }
  if (blank(next.venue.prefecture) && x.prefecture) {
    next.venue.prefecture = x.prefecture
    filled.push("prefecture")
  }
  if (blank(next.venue.city) && x.city) {
    next.venue.city = x.city
    filled.push("city")
  }
  if (blank(next.officialUrl) && x.officialUrl) {
    next.officialUrl = x.officialUrl
    filled.push("officialUrl")
  }
  if (blank(next.imageUrl) && imageUrl) {
    next.imageUrl = imageUrl
    filled.push("imageUrl")
  }
  // "other" only means nothing specific was found: a stated genre may replace it.
  if (!hasGenre(next.genres) && hasGenre(x.genres)) {
    next.genres = x.genres
    filled.push("genres")
  }
  if (!hasType(next.eventTypes) && hasType(x.eventTypes)) {
    next.eventTypes = x.eventTypes
    filled.push("eventTypes")
  }

  return { event: next, filled, notes }
}

/**
 * Read the given source pages and fill the event's empty fields with what they state.
 * Failing sources are reported, the others are still used.
 */
export const enrichFromSources = async (
  event: Event,
  sources: Source[],
  fetchText: FetchText,
  cfg: KeywordConfig
): Promise<EnrichResult> => {
  const pages: EnrichResult["pages"] = []
  const errors: string[] = []
  let extracted: Extracted | null = null
  let imageUrl: string | null = null

  for (const s of sources) {
    if (!isFetchable(s)) {
      errors.push(
        `${s.url}: 取得できない出典です（サンプル・Google ニュースなど）`
      )
      continue
    }
    let html: string
    try {
      html = await fetchText(s.url)
    } catch (e) {
      errors.push(`${s.url}: ${(e as Error).message}`)
      continue
    }
    const item = parseSourcePage(s.url, html)
    if (!item) {
      errors.push(`${s.url}: 内容を解析できませんでした`)
      continue
    }
    const ref = item.publishedAt ?? s.publishedAt
    const x = extract(item.title, item.summary, cfg, ref)
    // An unlabelled date equal to the release date is the release date itself.
    const releaseDay = ref ? jstDay(ref) : null
    if (x.dateSource === "text" && x.startDate === releaseDay) {
      x.startDate = null
      x.endDate = null
      x.dateSource = null
    }
    extracted = extracted ? mergeExtracted(extracted, x) : x
    imageUrl ??= item.imageUrl ?? null
    pages.push({
      url: s.url,
      title: item.title,
      publishedAt: item.publishedAt,
    })
  }

  if (!extracted)
    return { event, filled: [], notes: [], extracted: null, pages, errors }
  const filled = fillMissing(event, extracted, imageUrl)
  return { ...filled, extracted, pages, errors }
}
