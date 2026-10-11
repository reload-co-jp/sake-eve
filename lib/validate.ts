import {
  ARTICLE_TYPES,
  EVENT_STATUSES,
  EVENT_TYPES,
  GENRES,
  PREFECTURES,
  PROCESSING_STATUSES,
  PUBLICATION_STATUSES,
  PRODUCER_TYPES,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
  type Db,
} from "./types.ts"

type Collection = keyof Db
type RawDb = Record<Collection, unknown[]>
type Ids = Record<Collection, Set<string>>
/** Returns an error message, or null when valid. */
type Rule = (value: unknown, ids: Ids) => string | null

const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

const text: Rule = (v) =>
  typeof v === "string" && v.trim() !== "" ? null : "空でない文字列が必要"
const slug: Rule = (v) =>
  typeof v === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)
    ? null
    : "slugは半角英小文字・数字・ハイフンのみ"
const iso: Rule = (v) =>
  typeof v === "string" && ISO_RE.test(v) && !isNaN(Date.parse(v))
    ? null
    : "タイムゾーン付きISO 8601日時が必要"
const date: Rule = (v) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? null
    : "YYYY-MM-DD形式が必要"
const url: Rule = (v) => {
  try {
    const p = new URL(v as string).protocol
    if (p === "http:" || p === "https:") return null
  } catch {
    // fallthrough
  }
  return "http(s) URLが必要"
}
const num =
  (min: number, max: number): Rule =>
  (v) =>
    typeof v === "number" && v >= min && v <= max
      ? null
      : `${min}〜${max}の数値が必要`
const bool: Rule = (v) => (typeof v === "boolean" ? null : "真偽値が必要")
const obj: Rule = (v) =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? null
    : "オブジェクトが必要"
const oneOf =
  (keys: readonly string[]): Rule =>
  (v) =>
    keys.includes(v as string) ? null : `次のいずれかが必要: ${keys.join(", ")}`
const listOf =
  (rule: Rule, nonEmpty = false): Rule =>
  (v, ids) => {
    if (!Array.isArray(v)) return "配列が必要"
    if (nonEmpty && v.length === 0) return "1件以上必要"
    const errs = v.map((x) => rule(x, ids)).filter(Boolean)
    return errs.length ? errs.join("; ") : null
  }
const ref =
  (col: Collection): Rule =>
  (v, ids) =>
    ids[col].has(v as string) ? null : `存在しない${col}のID: ${String(v)}`
const refs = (col: Collection) => listOf(ref(col))
const nullable =
  (rule: Rule): Rule =>
  (v, ids) =>
    v === null ? null : rule(v, ids)

const genres = listOf(oneOf(Object.keys(GENRES)), true)
const prefecture = nullable(oneOf(PREFECTURES))

const SCHEMA: Record<Collection, Record<string, Rule>> = {
  events: {
    id: text,
    slug,
    title: text,
    description: nullable(text),
    genres,
    eventTypes: listOf(oneOf(Object.keys(EVENT_TYPES)), true),
    startAt: nullable(iso),
    endAt: nullable(iso),
    venue: obj,
    organizer: nullable(text),
    officialUrl: nullable(url),
    ticketUrl: nullable(url),
    imageUrl: nullable(url),
    price: nullable(text),
    isFree: nullable(bool),
    reservationRequired: nullable(bool),
    sourceIds: listOf(ref("sources"), true),
    producerIds: refs("producers"),
    productIds: refs("products"),
    articleIds: refs("articles"),
    status: oneOf(Object.keys(EVENT_STATUSES)),
    dateOnly: bool,
    isSample: bool,
    publication: oneOf(Object.keys(PUBLICATION_STATUSES)),
    verificationStatus: oneOf(Object.keys(VERIFICATION_STATUSES)),
    lastVerifiedAt: nullable(iso),
    createdAt: iso,
    updatedAt: iso,
  },
  sources: {
    id: text,
    sourceType: oneOf(Object.keys(SOURCE_TYPES)),
    url,
    title: text,
    publisher: nullable(text),
    publishedAt: nullable(iso),
    fetchedAt: iso,
    contentHash: nullable(text),
    relatedEventIds: refs("events"),
    processingStatus: oneOf(PROCESSING_STATUSES),
    extractedFields: nullable(obj),
  },
  articles: {
    id: text,
    slug,
    title: text,
    summary: text,
    body: text,
    thumbnail: nullable(text),
    articleType: oneOf(Object.keys(ARTICLE_TYPES)),
    eventIds: refs("events"),
    producerIds: refs("producers"),
    productIds: refs("products"),
    sourceIds: refs("sources"),
    publishedAt: iso,
    updatedAt: iso,
    isSample: bool,
  },
  producers: {
    id: text,
    slug,
    name: text,
    aliases: listOf(text),
    producerType: oneOf(Object.keys(PRODUCER_TYPES)),
    address: nullable(text),
    prefecture,
    officialUrl: nullable(url),
    genres,
    productIds: refs("products"),
    eventIds: refs("events"),
    articleIds: refs("articles"),
    isSample: bool,
  },
  products: {
    id: text,
    slug,
    name: text,
    producerId: nullable(ref("producers")),
    genres,
    description: nullable(text),
    releaseDate: nullable(date),
    officialUrl: nullable(url),
    eventIds: refs("events"),
    articleIds: refs("articles"),
    sourceIds: refs("sources"),
    isSample: bool,
  },
}

const VENUE: Record<string, Rule> = {
  name: nullable(text),
  address: nullable(text),
  prefecture,
  city: nullable(text),
  latitude: nullable(num(-90, 90)),
  longitude: nullable(num(-180, 180)),
}

const checkFields = (
  item: Record<string, unknown>,
  schema: Record<string, Rule>,
  ids: Ids,
  where: string,
  errors: string[]
) => {
  for (const [key, rule] of Object.entries(schema)) {
    // Unknown values must be explicit null, never omitted.
    const err = key in item ? rule(item[key], ids) : "必須項目（不明ならnull）"
    if (err) errors.push(`${where}.${key}: ${err}`)
  }
}

/** Validates all collections. Returns a list of human-readable errors (empty = valid). */
export const validateDb = (db: RawDb): string[] => {
  const errors: string[] = []
  const cols = Object.keys(SCHEMA) as Collection[]
  const ids = Object.fromEntries(cols.map((c) => [c, new Set<string>()])) as Ids

  for (const col of cols) {
    const slugs = new Set<string>()
    db[col].forEach((raw, i) => {
      const { id, slug } = raw as { id?: string; slug?: string }
      if (ids[col].has(id)) errors.push(`${col}[${i}].id: 重複ID ${id}`)
      ids[col].add(id)
      if (slug !== undefined) {
        if (slugs.has(slug)) errors.push(`${col}[${i}].slug: 重複slug ${slug}`)
        slugs.add(slug)
      }
    })
  }

  for (const col of cols) {
    db[col].forEach((raw, i) => {
      const item = raw as Record<string, unknown>
      const where = `${col}[${i}](${String(item.id)})`
      checkFields(item, SCHEMA[col], ids, where, errors)
      if (col !== "events") return
      if (obj(item.venue, ids) === null) {
        const venue = item.venue as Record<string, unknown>
        checkFields(venue, VENUE, ids, `${where}.venue`, errors)
        if ((venue.latitude === null) !== (venue.longitude === null))
          errors.push(`${where}.venue: 緯度・経度は両方指定か両方null`)
      }
      const { startAt, endAt } = item as {
        startAt: string | null
        endAt: string | null
      }
      if (endAt && !startAt) errors.push(`${where}: endAtのみ指定されている`)
      if (
        item.publication === "published" &&
        item.verificationStatus === "needs_review"
      )
        errors.push(`${where}: 要確認(needs_review)のまま公開できない`)
      if (startAt && endAt && Date.parse(endAt) < Date.parse(startAt))
        errors.push(`${where}: endAtがstartAtより前`)
    })
  }

  // Producers: the same official URL, or a name/alias shared by two records, is a likely duplicate.
  const seen = new Map<string, string>()
  for (const raw of db.producers) {
    const p = raw as {
      id: string
      name?: string
      aliases?: string[]
      officialUrl?: string | null
    }
    const keys = [p.name, ...(p.aliases ?? [])]
      .filter(Boolean)
      .map((n) => `name:${n!.normalize("NFKC").replace(/\s/g, "")}`)
    if (p.officialUrl) keys.push(`url:${p.officialUrl.replace(/\/+$/, "")}`)
    for (const k of new Set(keys)) {
      const other = seen.get(k)
      if (other && other !== p.id)
        errors.push(`producers(${p.id}): ${other} と重複の可能性 (${k})`)
      seen.set(k, p.id)
    }
  }
  return errors
}
