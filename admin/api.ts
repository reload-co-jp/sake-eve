/**
 * Admin operations on the JSON data store. Pure functions: callers load the db,
 * apply one operation and persist only when no validation errors are returned.
 */
import type { Db, PublicationStatus } from "../lib/types.ts"
import { validateDb } from "../lib/validate.ts"
import { normalizeUrl, type DuplicateCandidate } from "../collector/dedupe.ts"
import type { KeywordConfig } from "../collector/extract.ts"
import { merge } from "../collector/store.ts"
import { parseWebPage } from "../collector/web.ts"

/** Collections editors may change. Sources record what was fetched: they can be added, never edited. */
export const EDITABLE = ["events", "articles", "producers", "products"] as const
export type Editable = (typeof EDITABLE)[number] | "sources"

export type AuditEntry = {
  at: string
  collection: string
  id: string
  action: "create" | "update" | PublicationStatus
  changedFields: string[]
  note: string | null
}

export type Result =
  | { ok: true; db: Db; audit: AuditEntry; changed: Editable }
  | { ok: false; status: number; errors: string[] }

const fail = (status: number, ...errors: string[]): Result => ({
  ok: false,
  status,
  errors,
})

const changedFields = (before: object | undefined, after: object) =>
  Object.keys({ ...before, ...after }).filter(
    (k) =>
      JSON.stringify((before as Record<string, unknown>)?.[k]) !==
      JSON.stringify((after as Record<string, unknown>)[k])
  )

const isEditable = (c: string, mode: "create" | "update"): c is Editable =>
  (EDITABLE as readonly string[]).includes(c) ||
  (c === "sources" && mode === "create")

/** Create or replace one record. IDs are immutable; event publication changes only via setPublication. */
export const upsert = (
  db: Db,
  collection: string,
  id: string,
  record: Record<string, unknown>,
  now: string,
  mode: "create" | "update"
): Result => {
  if (!isEditable(collection, mode))
    return fail(400, `編集できないコレクション: ${collection}`)
  if (typeof record !== "object" || record === null || Array.isArray(record))
    return fail(400, "レコードはオブジェクトで指定してください")
  if (record.id !== id) return fail(400, "IDは変更できません")
  const list = db[collection] as unknown as Record<string, unknown>[]
  const index = list.findIndex((x) => x.id === id)
  if (mode === "create" && index >= 0) return fail(409, `既に存在するID: ${id}`)
  if (mode === "update" && index < 0) return fail(404, `存在しないID: ${id}`)

  const before = index >= 0 ? list[index] : undefined
  const next = { ...record }
  if (collection === "events") {
    next.publication = before ? before.publication : "pending"
    next.updatedAt = now
    if (!before) next.createdAt = now
  }
  const items = [...list]
  if (index >= 0) items[index] = next
  else items.push(next)
  const nextDb = { ...db, [collection]: items } as Db

  const errors = validateDb(nextDb as never)
  if (errors.length) return fail(422, ...errors)
  return {
    ok: true,
    db: nextDb,
    changed: collection,
    audit: {
      at: now,
      collection,
      id,
      action: mode,
      changedFields: changedFields(before, next),
      note: null,
    },
  }
}

/** Approval step: publish, hide or send back to the queue. */
export const setPublication = (
  db: Db,
  id: string,
  publication: PublicationStatus,
  note: string | null,
  now: string
): Result => {
  if (!["pending", "published", "hidden"].includes(publication))
    return fail(400, `不正な公開状態: ${publication}`)
  const index = db.events.findIndex((e) => e.id === id)
  if (index < 0) return fail(404, `存在しないイベント: ${id}`)
  const event = db.events[index]
  if (
    publication === "published" &&
    event.verificationStatus === "needs_review"
  )
    return fail(
      422,
      "確認状態が「要確認」のままでは公開できません。内容を確認して確認状態を更新してください。"
    )
  const events = [...db.events]
  events[index] = { ...event, publication, updatedAt: now }
  const nextDb = { ...db, events }
  const errors = validateDb(nextDb as never)
  if (errors.length) return fail(422, ...errors)
  return {
    ok: true,
    db: nextDb,
    changed: "events",
    audit: {
      at: now,
      collection: "events",
      id,
      action: publication,
      changedFields: ["publication"],
      note: note?.trim() || null,
    },
  }
}

/** URLs the import endpoint will fetch: public http(s) pages, never Google News redirects or local hosts. */
export const checkImportUrl = (raw: string): string | null => {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return "URLの形式が正しくありません"
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    return "http(s) のURLを指定してください"
  if (/(^|\.)news\.google\.com$/.test(u.hostname))
    return "Google ニュースのリンクは取得できません（利用条件・robots.txt）。記事を開いて元のサイトのURLを貼ってください"
  if (
    u.hostname === "localhost" ||
    /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ||
    u.hostname.startsWith("[")
  )
    return "IPアドレス・ローカルホストは指定できません"
  return null
}

export type ImportResult =
  | {
      ok: true
      db: Db
      candidates: DuplicateCandidate[]
      eventId: string
      audit: AuditEntry
    }
  | { ok: false; status: number; errors: string[]; eventId?: string }

/** Turn one fetched page into a pending event + source (same extraction as the collector). */
export const importPage = (
  db: Db,
  url: string,
  html: string,
  cfg: KeywordConfig,
  now: string
): ImportResult => {
  const item = parseWebPage(html, url)
  if (!item)
    return {
      ok: false,
      status: 422,
      errors: ["ページからタイトルを取得できませんでした"],
    }
  const key = normalizeUrl(url)
  const existing = db.sources.find((s) => normalizeUrl(s.url) === key)
  if (existing)
    return {
      ok: false,
      status: 409,
      errors: ["このURLは登録済みです"],
      eventId: existing.relatedEventIds[0],
    }
  const sourceType = new URL(url).hostname.endsWith("prtimes.jp")
    ? "prtimes"
    : "news"
  const r = merge(db, [{ sourceType, item }], cfg, now, { skipRelevance: true })
  const errors = validateDb(r.db as never)
  if (errors.length) return { ok: false, status: 422, errors }
  const event = r.db.events[r.db.events.length - 1]
  return {
    ok: true,
    db: r.db,
    candidates: r.candidates,
    eventId: event.id,
    audit: {
      at: now,
      collection: "events",
      id: event.id,
      action: "create",
      changedFields: ["(URL取り込み)"],
      note: url,
    },
  }
}
