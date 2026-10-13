import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { AuditEntry } from "../admin/api.ts"
import type { Db, Event, Source, SourceType } from "../lib/types.ts"
import { validateDb } from "../lib/validate.ts"
import {
  findDuplicateCandidates,
  normalizeUrl,
  sha256,
  type DuplicateCandidate,
} from "./dedupe.ts"
import {
  extract,
  hasEventKeyword,
  isRelevant,
  type KeywordConfig,
} from "./extract.ts"
import type { RawItem } from "./sources.ts"

const COLLECTIONS = [
  "events",
  "sources",
  "articles",
  "producers",
  "products",
] as const

const readJson = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback
    throw e
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written JSON. */
export const writeJson = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + "\n")
  renameSync(`${path}.tmp`, path)
}

export const loadDb = (dir: string): Db =>
  Object.fromEntries(
    COLLECTIONS.map((c) => [c, readJson(join(dir, `${c}.json`), [])])
  ) as Db

export type MergeStats = {
  fetched: number
  irrelevant: number
  duplicateUrl: number
  added: number
  needsReview: number
  autoPublished: number
  duplicateCandidates: number
}

/** YYYY-MM-DD in JST. */
const jstDay = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10)

/**
 * Append new items to the db. Existing records are never modified or removed:
 * a known URL is skipped, and look-alike events are only flagged as candidates.
 */
export const merge = (
  db: Db,
  items: { sourceType: SourceType; item: RawItem }[],
  cfg: KeywordConfig,
  now: string,
  /** Editor-chosen items (URL import) skip the keyword relevance filter. */
  opts: { skipRelevance?: boolean } = {}
) => {
  const next: Db = { ...db, events: [...db.events], sources: [...db.sources] }
  const known = new Set(db.sources.map((s) => normalizeUrl(s.url)))
  const candidates: DuplicateCandidate[] = []
  const audit: AuditEntry[] = []
  const stats: MergeStats = {
    fetched: items.length,
    irrelevant: 0,
    duplicateUrl: 0,
    added: 0,
    needsReview: 0,
    autoPublished: 0,
    duplicateCandidates: 0,
  }

  for (const { sourceType, item } of items) {
    const text = `${item.title}\n${item.summary}`.normalize("NFKC")
    // News snippets mention drinks in passing ("飲食ブースも"); judge them by the headline only.
    const relevanceText =
      sourceType === "news" ? item.title.normalize("NFKC") : text
    if (!opts.skipRelevance && !isRelevant(relevanceText, cfg)) {
      stats.irrelevant++
      continue
    }
    const key = normalizeUrl(item.url)
    if (known.has(key)) {
      stats.duplicateUrl++
      continue
    }
    known.add(key)

    const hash = sha256(key).slice(0, 12)
    const x = extract(item.title, item.summary, cfg, item.publishedAt)
    // An unlabelled date equal to the release date is almost always the release date itself.
    const releaseDay = item.publishedAt ? jstDay(item.publishedAt) : null
    if (x.dateSource === "text" && x.startDate === releaseDay) {
      x.startDate = null
      x.endDate = null
      x.dateSource = null
    }
    // Without event words it may be a product launch or campaign: always review.
    const eventLike = hasEventKeyword(text, cfg)
    const event: Event = {
      id: `evt-${hash}`,
      slug: `e-${hash}`,
      title: item.title,
      // The source text is not republished; the detail page links to the original.
      description: null,
      genres: x.genres,
      eventTypes: x.eventTypes,
      startAt: x.startDate ? `${x.startDate}T00:00:00+09:00` : null,
      endAt: x.endDate ? `${x.endDate}T23:59:00+09:00` : null,
      venue: {
        name: x.venueName,
        address: x.address,
        prefecture: x.prefecture,
        city: x.city,
        latitude: null,
        longitude: null,
      },
      organizer: null,
      officialUrl: x.officialUrl,
      ticketUrl: null,
      imageUrl: item.imageUrl ?? null,
      price: null,
      isFree: null,
      reservationRequired: null,
      sourceIds: [`src-${hash}`],
      producerIds: [],
      productIds: [],
      articleIds: [],
      status: x.startDate ? "scheduled" : "unknown",
      verificationStatus: "unverified",
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
      dateOnly: true,
      isSample: false,
      // Collected items always wait for editor approval before appearing on the site.
      publication: "pending",
    }
    const dupes = findDuplicateCandidates(event, next.events, now)
    candidates.push(...dupes)
    const needsReview =
      dupes.length > 0 ||
      !eventLike ||
      x.dateSource !== "label" ||
      !x.prefecture
    if (needsReview) {
      event.verificationStatus = "needs_review"
      stats.needsReview++
    } else if (x.venueName && x.startDate && x.startDate >= jstDay(now)) {
      // Labelled date + venue + prefecture, event words, no look-alike, upcoming: safe to show.
      event.publication = "published"
      stats.autoPublished++
      audit.push({
        at: now,
        collection: "events",
        id: event.id,
        action: "published",
        changedFields: ["publication"],
        note: "auto: 収集時の自動公開",
      })
    }
    const source: Source = {
      id: `src-${hash}`,
      sourceType,
      url: item.url,
      title: item.title,
      publisher: item.publisher,
      publishedAt: item.publishedAt,
      fetchedAt: now,
      contentHash: sha256(`${item.title.normalize("NFKC").trim()}\n${key}`),
      relatedEventIds: [event.id],
      processingStatus: needsReview ? "needs_review" : "processed",
      extractedFields: {
        ...x,
        eventKeywordMatched: eventLike,
        duplicateCandidateIds: dupes.map((d) => d.candidateEventId),
      },
    }
    next.events.push(event)
    next.sources.push(source)
    stats.added++
  }
  stats.duplicateCandidates = candidates.length
  return { db: next, stats, candidates, audit }
}

/**
 * Hide pending events that review would reject anyway: already over, no event words
 * (launches, campaigns), or still undated 60+ days after the source was published.
 */
export const triage = (db: Db, now: string, staleDays = 60) => {
  const sources = new Map(db.sources.map((s) => [s.id, s]))
  const audit: AuditEntry[] = []
  const events = db.events.map((e) => {
    if (e.publication !== "pending" || e.isSample) return e
    const src = e.sourceIds.map((id) => sources.get(id)).find(Boolean)
    const last = e.endAt ?? e.startAt
    const note =
      last && Date.parse(last) < Date.parse(now)
        ? "auto: 開催終了"
        : src?.extractedFields?.eventKeywordMatched === false
          ? "auto: イベント語なし"
          : !e.startAt &&
              src?.publishedAt &&
              Date.parse(now) - Date.parse(src.publishedAt) > staleDays * 864e5
            ? `auto: 配信${staleDays}日超で日付不明`
            : null
    if (!note) return e
    audit.push({
      at: now,
      collection: "events",
      id: e.id,
      action: "hidden",
      changedFields: ["publication"],
      note,
    })
    return { ...e, publication: "hidden" as const, updatedAt: now }
  })
  return { db: { ...db, events }, audit }
}

export type RunLog = {
  startedAt: string
  finishedAt: string
  dryRun: boolean
  sources: {
    id: string
    status: "ok" | "skipped" | "blocked" | "error"
    items: number
    message?: string
  }[]
  stats:
    | (MergeStats & {
        autoHidden: number
        summarized?: number
        geocoded?: number
      })
    | null
  validationErrors: string[]
  written: boolean
}

/** Validate then persist. Returns validation errors; nothing is written when there are any. */
export const save = (
  dir: string,
  db: Db,
  candidates: DuplicateCandidate[]
): string[] => {
  const errors = validateDb(db)
  if (errors.length) return errors
  writeJson(join(dir, "events.json"), db.events)
  writeJson(join(dir, "sources.json"), db.sources)
  if (candidates.length) {
    const path = join(dir, "review", "duplicate-candidates.json")
    writeJson(path, [
      ...readJson<DuplicateCandidate[]>(path, []),
      ...candidates,
    ])
  }
  return []
}

export const appendRunLog = (dir: string, log: RunLog, keep = 100) => {
  const path = join(dir, "review", "collect-log.json")
  writeJson(path, [...readJson<RunLog[]>(path, []), log].slice(-keep))
}
