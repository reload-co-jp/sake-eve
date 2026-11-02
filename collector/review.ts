/**
 * Automated first-pass review of collected events.
 *
 * Claude reads the source page and states each fact together with a verbatim quote from it.
 * The code then trusts only facts whose quote really appears in the page (no guessing),
 * fills the event's empty fields with them and decides:
 *
 * - not an attendable event (product launch, campaign, past-event report) → hidden
 * - date, venue and prefecture confirmed by quotes, upcoming, no look-alike → published
 * - anything else → stays pending with the list of what an editor still has to check
 *
 * Values an editor entered are never overwritten. Every decision goes to the audit log
 * with an "auto-review:" note, and the per-event result to data/review/auto-review.json.
 */
import Anthropic from "@anthropic-ai/sdk"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"
import type { AuditEntry } from "../admin/api.ts"
import { PREFECTURES, type Event } from "../lib/types.ts"

const execFile = promisify(execFileCb)

const quoted = (value: { type: string }) => ({
  type: "object",
  additionalProperties: false,
  required: ["value", "quote"],
  properties: {
    value: { anyOf: [value, { type: "null" }] },
    quote: { type: ["string", "null"] },
  },
})

/** Structured output schema: every fact carries the source sentence it came from. */
export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "isEvent",
    "reason",
    "name",
    "description",
    "startDate",
    "endDate",
    "venueName",
    "address",
    "prefecture",
    "city",
    "price",
    "isFree",
    "reservationRequired",
    "officialUrl",
    "organizer",
  ],
  properties: {
    isEvent: { type: "boolean" },
    reason: { type: "string" },
    name: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    startDate: quoted({ type: "string" }),
    endDate: quoted({ type: "string" }),
    venueName: quoted({ type: "string" }),
    address: quoted({ type: "string" }),
    prefecture: quoted({ type: "string" }),
    city: quoted({ type: "string" }),
    price: quoted({ type: "string" }),
    isFree: quoted({ type: "boolean" }),
    reservationRequired: quoted({ type: "boolean" }),
    officialUrl: quoted({ type: "string" }),
    organizer: quoted({ type: "string" }),
  },
} as const

type Quoted<T> = { value: T | null; quote: string | null }

export type ReviewAnswer = {
  isEvent: boolean
  reason: string
  name: string | null
  description: string | null
  startDate: Quoted<string>
  endDate: Quoted<string>
  venueName: Quoted<string>
  address: Quoted<string>
  prefecture: Quoted<string>
  city: Quoted<string>
  price: Quoted<string>
  isFree: Quoted<boolean>
  reservationRequired: Quoted<boolean>
  officialUrl: Quoted<string>
  organizer: Quoted<string>
}

const SYSTEM = `お酒のイベント情報サイトの編集者として、プレスリリースや記事の本文を読み、掲載するイベントの情報を確認する。
- isEvent: 一般の人が参加できる、これから開催されるお酒のイベント（フェス・試飲会・蔵開き・セミナー・飲み歩き等）なら true。新商品の発売、キャンペーン、店舗の開業、メニュー紹介、すでに終わったイベントの開催報告なら false。
- reason: isEvent の判断理由を日本語で1文。
- name: イベントの正式名称。【】や宣伝文句、日付は付けない。名称が本文になければ内容が分かる短い名前。
- description: 何が楽しめるイベントかを日本語の常体（だ・である調）で2文、120字以内。日時・会場・料金は書かない。原文をそのまま写さず自分の言葉でまとめる。
- 各項目の value は本文に書かれている事実だけ。書かれていなければ value と quote を null にする。推測で補わない。
- quote は value の根拠となる本文の一部を、一字一句そのまま抜き出す（30字程度まで。改行は含めない）。要約・言い換えは不可。
- startDate / endDate は YYYY-MM-DD。年の記載がなければ配信日から判断する。1日だけなら endDate も同じ日。
- venueName は会場名、address は会場の住所（主催企業の本社所在地は使わない）。prefecture は「東京都」「大阪府」のような都道府県名。
- price は入場料・参加費を表示用に短く（例「4,000円」「前売2,000円〜」「無料」）。isFree は入場無料なら true、有料なら false。
- reservationRequired は事前予約・申込が必要なら true、予約不要なら false。
- officialUrl はイベントの公式サイトのURL（本文に書かれたもの）。チケット販売サイト・SNS・企業サイトは除く。
- organizer は主催者名。`

const userPrompt = (title: string, publishedAt: string | null, body: string) =>
  `タイトル: ${title}\n配信日: ${publishedAt ?? "不明"}\n\n${body}`

let client: Anthropic | null = null

/** Ask Claude (API, needs ANTHROPIC_API_KEY). null when the model declined or stopped early. */
export const askApi = async (
  title: string,
  publishedAt: string | null,
  body: string
): Promise<ReviewAnswer | null> => {
  client ??= new Anthropic()
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: REVIEW_SCHEMA },
    },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt(title, publishedAt, body) }],
  })
  if (res.stop_reason !== "end_turn") return null
  return parseAnswer(
    res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
  )
}

/** Same question on the local Claude Code CLI (logged-in subscription, no API key). */
export const askLocal = async (
  title: string,
  publishedAt: string | null,
  body: string
): Promise<ReviewAnswer | null> => {
  const run = execFile(
    "claude",
    [
      "-p",
      "--model",
      "opus",
      "--system-prompt",
      `${SYSTEM}\n\n次の JSON Schema に従う JSON オブジェクトだけを出力する。前置き・コードブロックは付けない。\n${JSON.stringify(REVIEW_SCHEMA)}`,
      "--tools",
      "",
      "--no-session-persistence",
    ],
    { maxBuffer: 10 * 1024 * 1024, timeout: 300_000 }
  )
  run.child.stdin?.end(userPrompt(title, publishedAt, body))
  return parseAnswer((await run).stdout)
}

/** The JSON object in the model output (tolerates a stray code fence), or null. */
export const parseAnswer = (text: string): ReviewAnswer | null => {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < start) return null
  try {
    const x = JSON.parse(text.slice(start, end + 1))
    return typeof x?.isEvent === "boolean" ? (x as ReviewAnswer) : null
  } catch {
    return null
  }
}

/** Compare text ignoring width, spacing and line breaks. */
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "")

const isYmd = (s: unknown): s is string =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().startsWith(s)

/** YYYY-MM-DD in JST. */
const jstDay = (iso: string) =>
  new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10)

/** Prefecture at the start of an address ("大阪府大阪市…" → 大阪府). */
export const prefectureOf = (address: string | null) => {
  const a = address?.normalize("NFKC").replace(/^〒?\s*\d{3}-\d{4}\s*/, "")
  return a ? (PREFECTURES.find((p) => a.startsWith(p)) ?? null) : null
}

export type CheckedFacts = {
  startDate: string | null
  endDate: string | null
  venueName: string | null
  address: string | null
  prefecture: string | null
  city: string | null
  price: string | null
  isFree: boolean | null
  reservationRequired: boolean | null
  officialUrl: string | null
  organizer: string | null
}

/**
 * Keep only facts backed by a verbatim quote from the page (and a URL that appears in it).
 * `rejected` lists the facts the model stated but could not back up.
 */
export const checkFacts = (
  a: ReviewAnswer,
  body: string,
  publishedAt: string | null
): { facts: CheckedFacts; rejected: string[] } => {
  const page = norm(body)
  const rejected: string[] = []
  const take = <T>(key: keyof CheckedFacts, q: Quoted<T> | undefined) => {
    if (!q || q.value === null || q.value === undefined) return null
    if (typeof q.value === "string" && !q.value.trim()) return null
    const quote = q.quote ? norm(q.quote) : ""
    if (quote.length < 2 || !page.includes(quote)) {
      rejected.push(key)
      return null
    }
    return q.value
  }
  let startDate = take("startDate", a.startDate)
  let endDate = take("endDate", a.endDate)
  if (startDate !== null && !isYmd(startDate)) {
    rejected.push("startDate")
    startDate = null
  }
  // A date far from the release date is more likely a misread year than the event.
  if (startDate && publishedAt) {
    const diff = (Date.parse(startDate) - Date.parse(publishedAt)) / 864e5
    if (diff < -7 || diff > 550) {
      rejected.push("startDate")
      startDate = null
    }
  }
  if (!startDate || !isYmd(endDate) || endDate < startDate) endDate = startDate
  const address = take("address", a.address)
  let prefecture = take("prefecture", a.prefecture)
  if (
    prefecture !== null &&
    !(PREFECTURES as readonly string[]).includes(prefecture)
  )
    prefecture = null
  prefecture ??= prefectureOf(address)
  let officialUrl = take("officialUrl", a.officialUrl)
  if (
    officialUrl !== null &&
    (!/^https?:\/\/[^\s]+$/.test(officialUrl) ||
      !page.includes(norm(officialUrl).replace(/\/$/, "")))
  ) {
    rejected.push("officialUrl")
    officialUrl = null
  }
  const price = take("price", a.price)
  let isFree = take("isFree", a.isFree)
  if (typeof isFree !== "boolean") isFree = null
  const reservationRequired = take("reservationRequired", a.reservationRequired)
  return {
    facts: {
      startDate,
      endDate,
      venueName: take("venueName", a.venueName),
      address,
      prefecture,
      city: take("city", a.city),
      price,
      isFree,
      reservationRequired:
        typeof reservationRequired === "boolean" ? reservationRequired : null,
      officialUrl,
      organizer: take("organizer", a.organizer),
    },
    rejected: [...new Set(rejected)],
  }
}

export type ReviewDecision = "published" | "hidden" | "pending"

export type ReviewRecord = {
  eventId: string
  reviewedAt: string
  decision: ReviewDecision
  reason: string
  filled: string[]
  /** What an editor still has to check before publishing (empty when decided). */
  todo: string[]
  /** Facts the model stated without a matching quote (discarded). */
  rejected: string[]
}

const blank = (v: string | null) => v === null || v.trim() === ""

/**
 * Apply a checked review to one event. Pure: returns the next event, the audit entries
 * and the record for data/review/auto-review.json.
 */
export const applyReview = (
  event: Event,
  answer: ReviewAnswer,
  checked: { facts: CheckedFacts; rejected: string[] },
  ctx: {
    now: string
    /** Headline of the event's first source: a title still equal to it has not been named yet. */
    sourceTitle: string | null
    /** Look-alike events (duplicate candidates) exist. */
    hasDuplicates: boolean
  }
) => {
  const { facts } = checked
  const { now } = ctx
  const next = structuredClone(event)
  const filled: string[] = []
  const fill = <K extends keyof Event>(key: K, value: Event[K] | null) => {
    if (value === null || value === undefined) return
    const cur = next[key]
    if (cur === null || (typeof cur === "string" && blank(cur))) {
      next[key] = value
      filled.push(key)
    }
  }

  if (
    answer.isEvent &&
    answer.name?.trim() &&
    event.title === ctx.sourceTitle
  ) {
    next.title = answer.name.trim()
    filled.push("title")
  }
  if (answer.isEvent) fill("description", answer.description?.trim() || null)
  if (blank(next.startAt) && facts.startDate) {
    next.startAt = `${facts.startDate}T00:00:00+09:00`
    next.endAt = `${facts.endDate ?? facts.startDate}T23:59:00+09:00`
    next.dateOnly = true
    if (next.status === "unknown") next.status = "scheduled"
    filled.push("startAt", "endAt")
  }
  const v = next.venue
  for (const k of ["name", "address", "prefecture", "city"] as const) {
    const value = facts[k === "name" ? "venueName" : k]
    if (blank(v[k]) && value) {
      v[k] = value
      if (k === "address") {
        // Coordinates belong to the old address; the collector geocodes the new one.
        v.latitude = null
        v.longitude = null
      }
      filled.push(`venue.${k}`)
    }
  }
  fill("price", facts.price)
  fill("isFree", facts.isFree)
  fill("reservationRequired", facts.reservationRequired)
  fill("officialUrl", facts.officialUrl)
  fill("organizer", facts.organizer)

  const todo: string[] = []
  let decision: ReviewDecision = "pending"
  let reason = answer.reason
  const last = next.endAt ?? next.startAt
  if (!answer.isEvent) {
    decision = "hidden"
  } else if (last && Date.parse(last) < Date.parse(now)) {
    decision = "hidden"
    reason = "開催終了"
  } else {
    if (!next.startAt || !facts.startDate) todo.push("開催日")
    if (blank(next.venue.name) || !facts.venueName) todo.push("会場")
    if (blank(next.venue.prefecture) || !facts.prefecture) todo.push("都道府県")
    if (ctx.hasDuplicates) todo.push("重複候補")
    // Confirmed values must match what the event already holds (an editor may have typed others).
    if (facts.startDate && next.startAt?.slice(0, 10) !== facts.startDate)
      todo.push("開催日が出典と異なる")
    if (
      next.startAt &&
      next.startAt.slice(0, 10) < jstDay(now) &&
      !todo.includes("開催日")
    )
      todo.push("開催日が過去")
    if (!todo.length) decision = "published"
  }

  const audit: AuditEntry[] = []
  if (filled.length) {
    next.updatedAt = now
    audit.push({
      at: now,
      collection: "events",
      id: event.id,
      action: "update",
      changedFields: [...new Set(filled.map((f) => f.split(".")[0]))],
      note: `auto-review: 出典から入力（${filled.join(", ")}）`,
    })
  }
  if (decision === "published") {
    next.publication = "published"
    // Read from the source by the model and backed by quotes, but not checked by a person.
    next.verificationStatus = "partially_verified"
    next.updatedAt = now
    audit.push({
      at: now,
      collection: "events",
      id: event.id,
      action: "published",
      changedFields: ["publication", "verificationStatus"],
      note: "auto-review: 出典で日程・会場・都道府県を確認",
    })
  } else if (decision === "hidden") {
    next.publication = "hidden"
    next.updatedAt = now
    audit.push({
      at: now,
      collection: "events",
      id: event.id,
      action: "hidden",
      changedFields: ["publication"],
      note: `auto-review: ${reason}`,
    })
  }

  const record: ReviewRecord = {
    eventId: event.id,
    reviewedAt: now,
    decision,
    reason,
    filled,
    todo,
    rejected: checked.rejected,
  }
  return { event: next, audit, record }
}
