/**
 * Collect event candidates from enabled sources and append them to data/*.json.
 *
 *   node collector/run.ts            # fetch + write
 *   node collector/run.ts --dry-run  # fetch + report only
 *   node collector/run.ts --scheduled  # honour each source's runEveryHours (used by cron)
 *
 * Exit code 1 when every enabled source failed or validation failed (data is left untouched).
 */
import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { SourceType } from "../lib/types.ts"
import type { KeywordConfig } from "./extract.ts"
import { BlockedError, createFetcher } from "./http.ts"
import { ADAPTERS, type RawItem, type SourceConfig } from "./sources.ts"
import { normalizeUrl } from "./dedupe.ts"
import { appendRunLog, loadDb, merge, save, type RunLog } from "./store.ts"

type Config = KeywordConfig & {
  userAgent: string
  requestIntervalMs: number
  timeoutMs: number
  sources: SourceConfig[]
}

const root = join(import.meta.dirname, "..")
const dataDir = join(root, "data")
const dryRun = process.argv.includes("--dry-run")
const scheduled = process.argv.includes("--scheduled")
const config: Config = JSON.parse(
  readFileSync(join(import.meta.dirname, "config.json"), "utf8")
)

const log: RunLog = {
  startedAt: new Date().toISOString(),
  finishedAt: "",
  dryRun,
  sources: [],
  stats: null,
  validationErrors: [],
  written: false,
}
const fetchText = createFetcher({
  userAgent: config.userAgent,
  intervalMs: config.requestIntervalMs,
  timeoutMs: config.timeoutMs,
})

const db = loadDb(dataDir)
const known = new Set(db.sources.map((s) => normalizeUrl(s.url)))
const titleWords = [
  ...Object.values(config.genreKeywords).flat(),
  ...config.eventKeywords,
]

const items: { sourceType: SourceType; item: RawItem }[] = []
for (const source of config.sources) {
  const adapter = ADAPTERS[source.adapter]
  if (!source.enabled || !adapter) {
    const message = adapter
      ? (source.disabledReason ?? "disabled")
      : `unknown adapter: ${source.adapter}`
    log.sources.push({ id: source.id, status: "skipped", items: 0, message })
    console.log(`[skip] ${source.id}: ${message}`)
    continue
  }
  const every = source.runEveryHours ?? 1
  if (scheduled && new Date().getUTCHours() % every !== 0) {
    const message = `${every}時間ごとに実行（今回は対象外）`
    log.sources.push({ id: source.id, status: "skipped", items: 0, message })
    console.log(`[skip] ${source.id}: ${message}`)
    continue
  }
  const notes: string[] = []
  try {
    const got = await adapter.fetchItems(source, fetchText, {
      isKnown: (url) => known.has(normalizeUrl(url)),
      isCandidateTitle: (t) =>
        titleWords.some((w) => t.normalize("NFKC").includes(w)),
      log: (m) => notes.push(m),
    })
    items.push(...got.map((item) => ({ sourceType: adapter.sourceType, item })))
    const message = notes.join(" / ") || undefined
    log.sources.push({
      id: source.id,
      status: "ok",
      items: got.length,
      message,
    })
    console.log(
      `[ok] ${source.id}: ${got.length} items${message ? ` (${message})` : ""}`
    )
  } catch (e) {
    const status = e instanceof BlockedError ? "blocked" : "error"
    const message = (e as Error).message
    log.sources.push({ id: source.id, status, items: 0, message })
    console.error(`[${status}] ${source.id}: ${message}`)
  }
}

const enabled = log.sources.filter((s) => s.status !== "skipped")
const allFailed = enabled.length > 0 && enabled.every((s) => s.status !== "ok")

if (!allFailed) {
  const result = merge(db, items, config, new Date().toISOString())
  log.stats = result.stats
  console.log("[stats]", JSON.stringify(result.stats))
  if (!dryRun && result.stats.added > 0) {
    log.validationErrors = save(dataDir, result.db, result.candidates)
    log.written = log.validationErrors.length === 0
    for (const err of log.validationErrors) console.error(`[invalid] ${err}`)
  }
}

log.finishedAt = new Date().toISOString()
const failed = log.sources.some(
  (s) => s.status === "error" || s.status === "blocked"
)
// Persist the log only when something happened, so hourly runs don't create empty commits.
if (!dryRun && (log.written || failed || log.validationErrors.length))
  appendRunLog(dataDir, log)
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = log.sources.map(
    (s) => `| ${s.id} | ${s.status} | ${s.items} | ${s.message ?? ""} |`
  )
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      "## 収集結果",
      "| source | status | items | message |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
      "```json",
      JSON.stringify(log.stats, null, 2),
      "```",
      ...log.validationErrors.map((e) => `- ⚠️ ${e}`),
      "",
    ].join("\n")
  )
}
if (allFailed || log.validationErrors.length) process.exitCode = 1
