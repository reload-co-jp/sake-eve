import { createHash } from "node:crypto"
import type { Event } from "../lib/types.ts"

const TRACKING = /^(utm_|fbclid$|gclid$|yclid$|mc_|_ga$)/

/** Canonical form used to detect the same article behind different URLs. */
export const normalizeUrl = (raw: string) => {
  const u = new URL(raw)
  u.protocol = "https:"
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "")
  u.hash = ""
  for (const k of [...u.searchParams.keys()])
    if (TRACKING.test(k)) u.searchParams.delete(k)
  u.searchParams.sort()
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "")
  return u.toString()
}

export const sha256 = (s: string) =>
  createHash("sha256").update(s).digest("hex")

export const normalizeTitle = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[【[][^】\]]*[】\]]/g, "") // decorative "【PR】" etc.
    .replace(/[\s\p{P}\p{S}]/gu, "")

const bigrams = (s: string) => {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/** Dice coefficient over character bigrams (0..1). */
export const similarity = (a: string, b: string) => {
  const x = bigrams(normalizeTitle(a))
  const y = bigrams(normalizeTitle(b))
  if (!x.size || !y.size) return 0
  let hit = 0
  for (const g of x) if (y.has(g)) hit++
  return (2 * hit) / (x.size + y.size)
}

export type DuplicateCandidate = {
  eventId: string
  candidateEventId: string
  score: number
  reasons: string[]
  detectedAt: string
}

const day = (iso: string | null) => iso?.slice(0, 10) ?? null

/**
 * Possible duplicates of `e` among `others`. Never decides identity on its own:
 * results are recorded for human review and events are never merged automatically.
 */
export const findDuplicateCandidates = (
  e: Event,
  others: Event[],
  now: string
): DuplicateCandidate[] =>
  others.flatMap((o) => {
    if (o.id === e.id) return []
    const score = Math.round(similarity(e.title, o.title) * 100) / 100
    const sameDay = !!e.startAt && day(e.startAt) === day(o.startAt)
    const samePref =
      !!e.venue.prefecture && e.venue.prefecture === o.venue.prefecture
    const reasons = [
      score >= 0.6 && "similar_title",
      sameDay && "same_start_date",
      samePref && "same_prefecture",
    ].filter(Boolean) as string[]
    const suspicious = score >= 0.6 || (sameDay && score >= 0.3)
    return suspicious
      ? [
          {
            eventId: e.id,
            candidateEventId: o.id,
            score,
            reasons,
            detectedAt: now,
          },
        ]
      : []
  })
