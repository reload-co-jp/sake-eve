/**
 * Automated review of pending events (see review.ts).
 *
 *   node collector/review-run.ts                 # review pending events not reviewed yet, write data/
 *   node collector/review-run.ts --dry-run       # print the decisions only
 *   node collector/review-run.ts --local         # use the local Claude Code CLI instead of the API
 *   node collector/review-run.ts --only evt-xxx  # one event (any publication state)
 *   node collector/review-run.ts --force         # review again events reviewed before
 *   node collector/review-run.ts --limit 50      # max events this run (default 30)
 *   node collector/review-run.ts --report        # list what still needs a person, no requests
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { appendAudit } from "../admin/storage.ts"
import { autoReview, loadRecords, saveRecords } from "./auto-review.ts"
import { geocode } from "./geocode.ts"
import { createFetcher } from "./http.ts"
import { askApi, askLocal } from "./review.ts"
import { loadDb, save } from "./store.ts"

const root = join(import.meta.dirname, "..")
const dataDir = join(root, "data")
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const value = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const config = JSON.parse(
  readFileSync(join(import.meta.dirname, "config.json"), "utf8")
)

const db = loadDb(dataDir)
const records = loadRecords(dataDir)

if (flag("--report")) {
  const latest = new Map(records.map((r) => [r.eventId, r]))
  const pending = db.events.filter((e) => e.publication === "pending")
  console.log(`承認待ち ${pending.length}件`)
  for (const e of pending) {
    const r = latest.get(e.id)
    console.log(
      `- ${e.id} ${e.title}\n    ${
        r
          ? `自動確認 ${r.reviewedAt.slice(0, 10)}: 要確認 ${r.todo.join("・") || "なし"}（${r.reason}）`
          : "未確認（pnpm review で自動確認）"
      }`
    )
  }
  process.exit(0)
}

const dryRun = flag("--dry-run")
const local = flag("--local")
if (!local && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY がありません。Claude Code にログイン済みなら --local を付けてください。"
  )
  process.exit(1)
}
const fetchText = createFetcher({
  userAgent: config.userAgent,
  intervalMs: config.requestIntervalMs,
  timeoutMs: config.timeoutMs,
})
const now = new Date().toISOString()
const only = value("--only")
const r = await autoReview(db, {
  ask: local ? askLocal : askApi,
  fetchText,
  now,
  limit: Number(value("--limit") ?? 30),
  records,
  only: only ? [only] : undefined,
  force: flag("--force"),
  log: console.log,
})

// Coordinates for addresses filled by the review.
for (const e of r.db.events) {
  const v = e.venue
  if (dryRun || !v.address || v.latitude !== null || v.longitude !== null)
    continue
  if (!r.records.some((x) => x.eventId === e.id)) continue
  try {
    const c = await geocode(fetchText, v.address)
    if (c) Object.assign(v, c)
  } catch (err) {
    console.error(`[geocode] ${e.id}: ${(err as Error).message}`)
  }
}

console.log("[stats]", JSON.stringify(r.stats))
if (!dryRun && r.records.length) {
  const errors = save(dataDir, r.db, [])
  if (errors.length) {
    for (const err of errors) console.error(`[invalid] ${err}`)
    process.exit(1)
  }
  for (const a of r.audit) appendAudit(dataDir, a)
  saveRecords(dataDir, [...records, ...r.records])
}
