/**
 * Run the automated review (review.ts) over pending events: read each event's source,
 * ask Claude, keep only quote-backed facts, fill / publish / hide.
 * Used by the hourly collector and by `pnpm review`.
 */
import { join } from "node:path"
import { readFileSync } from "node:fs"
import type { AuditEntry } from "../admin/api.ts"
import type { Db } from "../lib/types.ts"
import { normalizeUrl, scanDuplicates } from "./dedupe.ts"
import type { FetchText } from "./http.ts"
import {
  applyReview,
  checkFacts,
  type ReviewAnswer,
  type ReviewRecord,
} from "./review.ts"
import { parseDetail } from "./sources.ts"
import { writeJson } from "./store.ts"

export type Ask = (
  title: string,
  publishedAt: string | null,
  body: string
) => Promise<ReviewAnswer | null>

export const recordsPath = (dataDir: string) =>
  join(dataDir, "review", "auto-review.json")

export const loadRecords = (dataDir: string): ReviewRecord[] => {
  try {
    return JSON.parse(readFileSync(recordsPath(dataDir), "utf8"))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return []
    throw e
  }
}

/** Latest record per event, newest last. */
export const saveRecords = (
  dataDir: string,
  records: ReviewRecord[],
  keep = 1000
) => {
  const latest = new Map(records.map((r) => [r.eventId, r]))
  writeJson(recordsPath(dataDir), [...latest.values()].slice(-keep))
}

export type AutoReviewStats = {
  reviewed: number
  published: number
  hidden: number
  pending: number
  failed: number
}

/**
 * Review pending events not reviewed before (or `only` / `force`), up to `limit`.
 * `bodies` holds page text already fetched this run (normalized URL → text); other
 * sources are fetched with `fetchText`. Returns the next db; nothing is written here.
 */
export const autoReview = async (
  db: Db,
  opts: {
    ask: Ask
    fetchText: FetchText
    now: string
    limit: number
    records: ReviewRecord[]
    bodies?: Map<string, string>
    only?: string[]
    force?: boolean
    log?: (m: string) => void
  }
) => {
  const { now, log = () => {} } = opts
  const reviewed = new Set(opts.records.map((r) => r.eventId))
  const sources = new Map(db.sources.map((s) => [s.id, s]))
  const events = [...db.events]
  const audit: AuditEntry[] = []
  const records: ReviewRecord[] = []
  const stats: AutoReviewStats = {
    reviewed: 0,
    published: 0,
    hidden: 0,
    pending: 0,
    failed: 0,
  }
  const dupes = scanDuplicates(events, now)
  let budget = opts.limit

  for (const [i, e] of events.entries()) {
    if (budget <= 0) break
    if (opts.only ? !opts.only.includes(e.id) : e.publication !== "pending")
      continue
    if (e.isSample || (!opts.force && !opts.only && reviewed.has(e.id)))
      continue
    const src = e.sourceIds.map((id) => sources.get(id)).find(Boolean)
    if (!src || src.sourceType === "sample" || src.sourceType === "google_news")
      continue
    budget--
    try {
      let body = opts.bodies?.get(normalizeUrl(src.url))
      let publishedAt = src.publishedAt
      if (!body) {
        const page = parseDetail(await opts.fetchText(src.url), src.url)
        body = page?.summary
        publishedAt ??= page?.publishedAt ?? null
      }
      if (!body?.trim()) throw new Error("本文を取得できませんでした")
      const answer = await opts.ask(src.title, publishedAt, body)
      if (!answer) throw new Error("回答を得られませんでした")
      const r = applyReview(e, answer, checkFacts(answer, body, publishedAt), {
        now,
        sourceTitle: src.title,
        hasDuplicates: dupes.some(
          (d) => d.eventId === e.id || d.candidateEventId === e.id
        ),
      })
      events[i] = r.event
      audit.push(...r.audit)
      records.push(r.record)
      stats.reviewed++
      stats[r.record.decision]++
      log(
        `[review] ${e.id} → ${r.record.decision}` +
          (r.record.todo.length ? ` 要確認: ${r.record.todo.join("・")}` : "") +
          ` (${r.record.reason})`
      )
    } catch (err) {
      stats.failed++
      log(`[review] ${e.id}: ${(err as Error).message}`)
    }
  }
  return { db: { ...db, events }, audit, records, stats }
}
