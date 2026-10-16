/**
 * Write an event_guide article for each published event that has none, from its source text.
 *
 *   node collector/articles.ts             # generate + write (max 10 per run)
 *   node collector/articles.ts --dry-run   # generate + print only
 *   node collector/articles.ts --limit 3
 *
 * Runs on the local Claude Code CLI (`claude` logged in); no API key needed.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { validateDb } from "../lib/validate.ts"
import type { Article } from "../lib/types.ts"
import { createFetcher } from "./http.ts"
import { parseDetail } from "./sources.ts"
import { loadDb, writeJson } from "./store.ts"
import { writeArticle } from "./summarize.ts"

const dataDir = join(import.meta.dirname, "..", "data")
const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const limitArg = args.indexOf("--limit")
let budget = limitArg >= 0 ? Number(args[limitArg + 1]) : 10
const config = JSON.parse(
  readFileSync(join(import.meta.dirname, "config.json"), "utf8")
)
const fetchText = createFetcher({
  userAgent: config.userAgent,
  intervalMs: config.requestIntervalMs,
  timeoutMs: config.timeoutMs,
})

const db = loadDb(dataDir)
const sourceById = new Map(db.sources.map((s) => [s.id, s]))
const covered = new Set(
  db.articles
    .filter((a) => a.articleType === "event_guide")
    .flatMap((a) => a.eventIds)
)
let written = 0
for (const e of db.events) {
  if (budget <= 0) break
  if (e.publication !== "published" || e.isSample || covered.has(e.id)) continue
  const url = sourceById.get(e.sourceIds[0] ?? "")?.url
  if (!url) continue
  budget--
  try {
    const text = parseDetail(await fetchText(url), url)?.summary
    const a = text && (await writeArticle(e.title, text))
    if (!a) {
      console.error(`[article] ${e.slug}: no output`)
      continue
    }
    const now = new Date().toISOString()
    const suffix = e.id.replace(/^evt-/, "")
    const article: Article = {
      id: `art-${suffix}`,
      slug: `a-${suffix}`,
      ...a,
      thumbnail: e.imageUrl,
      articleType: "event_guide",
      eventIds: [e.id],
      producerIds: [],
      productIds: [],
      sourceIds: e.sourceIds,
      publishedAt: now,
      updatedAt: now,
      isSample: false,
    }
    console.log(`\n=== ${e.slug}\n${a.title}\n${a.summary}\n\n${a.body}`)
    db.articles.push(article)
    e.articleIds = [...e.articleIds, article.id]
    written++
  } catch (err) {
    console.error(`[article] ${e.slug}: ${(err as Error).message}`)
  }
}

if (!dryRun && written) {
  const errors = validateDb(db)
  if (errors.length) {
    console.error(errors.join("\n"))
    process.exit(1)
  }
  writeJson(join(dataDir, "articles.json"), db.articles)
  writeJson(join(dataDir, "events.json"), db.events)
}
console.log(
  `\n${written} article(s) ${dryRun ? "generated (dry run)" : "written"}`
)
