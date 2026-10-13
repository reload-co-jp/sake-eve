/**
 * Local admin UI for editing data/*.json and approving events.
 *
 *   pnpm admin   # http://127.0.0.1:4321
 *
 * Local only: binds to 127.0.0.1, rejects foreign Host headers (DNS rebinding) and
 * requires a per-run token on every API call (blocks requests from other sites).
 * Changes are written to the working tree; publish them by opening a pull request.
 */
import { randomBytes, timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { join } from "node:path"
import { appendAudit, loadReview } from "./storage.ts"
import {
  checkImportUrl,
  importPage,
  setPublication,
  upsert,
  type Result,
} from "./api.ts"
import { createFetcher } from "../collector/http.ts"
import { loadDb, save, writeJson } from "../collector/store.ts"
import {
  ARTICLE_TYPES,
  EVENT_STATUSES,
  EVENT_TYPES,
  GENRES,
  PREFECTURES,
  PRODUCER_TYPES,
  PUBLICATION_STATUSES,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
} from "../lib/types.ts"

const PORT = Number(process.env.ADMIN_PORT ?? 4321)
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
const TOKEN = randomBytes(24).toString("hex")
const root = join(import.meta.dirname, "..")
const dataDir = join(root, "data")
const MAX_BODY = 1_000_000
const collectorConfig = JSON.parse(
  readFileSync(join(root, "collector", "config.json"), "utf8")
)
/** Search words for the "find on Google News" links (opened by the editor, never fetched). */
const NEWS_QUERIES: string[] = (
  collectorConfig.sources.find((s: { id: string }) => s.id === "google_news")
    ?.queries ?? []
).map((q: { q: string }) => q.q)
// Same polite client as the collector: robots.txt, UA, timeout, spacing.
const fetchPage = createFetcher({
  userAgent: collectorConfig.userAgent,
  intervalMs: collectorConfig.requestIntervalMs,
  timeoutMs: collectorConfig.timeoutMs,
})

const ENUMS = {
  genres: GENRES,
  eventTypes: EVENT_TYPES,
  eventStatuses: EVENT_STATUSES,
  verificationStatuses: VERIFICATION_STATUSES,
  publicationStatuses: PUBLICATION_STATUSES,
  sourceTypes: SOURCE_TYPES,
  articleTypes: ARTICLE_TYPES,
  producerTypes: PRODUCER_TYPES,
  prefectures: PREFECTURES,
}

const send = (
  res: ServerResponse,
  status: number,
  body: unknown,
  type = "application/json"
) => {
  res.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://msearch.gsi.go.jp; frame-ancestors 'none'",
  })
  res.end(type === "application/json" ? JSON.stringify(body) : String(body))
}

const readBody = (req: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) reject(new Error("too large"))
      else chunks.push(c)
    })
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"))
      } catch {
        reject(new Error("invalid json"))
      }
    })
    req.on("error", reject)
  })

const tokenOk = (req: IncomingMessage) => {
  const got = Buffer.from(String(req.headers["x-admin-token"] ?? ""))
  const want = Buffer.from(TOKEN)
  return got.length === want.length && timingSafeEqual(got, want)
}

const persist = (res: ServerResponse, result: Result) => {
  if ("errors" in result)
    return send(res, result.status, { errors: result.errors })
  writeJson(join(dataDir, `${result.changed}.json`), result.db[result.changed])
  appendAudit(dataDir, result.audit)
  send(res, 200, { ok: true, audit: result.audit })
}

const page = () =>
  readFileSync(join(import.meta.dirname, "index.html"), "utf8").replace(
    "__ADMIN_TOKEN__",
    TOKEN
  )

const server = createServer(async (req, res) => {
  if (!HOSTS.has(req.headers.host ?? ""))
    return send(res, 403, { errors: ["forbidden host"] })
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`)

  if (req.method === "GET" && url.pathname === "/")
    return send(res, 200, page(), "text/html")
  if (req.method === "GET" && url.pathname === "/app.js")
    return send(
      res,
      200,
      readFileSync(join(import.meta.dirname, "app.js"), "utf8"),
      "text/javascript"
    )
  if (!url.pathname.startsWith("/api/"))
    return send(res, 404, { errors: ["not found"] })

  const origin = req.headers.origin
  if (
    (origin && !HOSTS.has(origin.replace(/^https?:\/\//, ""))) ||
    !tokenOk(req)
  )
    return send(res, 403, { errors: ["forbidden"] })

  try {
    // Always read from disk so edits by the collector or by hand are picked up.
    const db = loadDb(dataDir)
    const now = new Date().toISOString()
    const parts = url.pathname.split("/").slice(2).map(decodeURIComponent)

    if (req.method === "GET" && parts[0] === "state")
      return send(res, 200, {
        db,
        enums: ENUMS,
        newsQueries: NEWS_QUERIES,
        ...loadReview(dataDir),
      })

    if (req.method === "POST" && parts[0] === "import" && parts.length === 1) {
      const { url } = ((await readBody(req)) ?? {}) as { url?: string }
      const bad = checkImportUrl(String(url ?? "").trim())
      if (bad) return send(res, 400, { errors: [bad] })
      let html: string
      try {
        html = await fetchPage(String(url).trim())
      } catch (e) {
        return send(res, 502, {
          errors: [`取得できませんでした: ${(e as Error).message}`],
        })
      }
      const r = importPage(db, String(url).trim(), html, collectorConfig, now)
      if ("errors" in r)
        return send(res, r.status, { errors: r.errors, eventId: r.eventId })
      const errors = save(dataDir, r.db, r.candidates)
      if (errors.length) return send(res, 422, { errors })
      appendAudit(dataDir, r.audit)
      return send(res, 200, { ok: true, eventId: r.eventId })
    }

    if (
      req.method === "POST" &&
      parts[0] === "events" &&
      parts[2] === "publication" &&
      parts.length === 3
    ) {
      const body = (await readBody(req)) as {
        publication?: string
        note?: string
      }
      return persist(
        res,
        setPublication(
          db,
          parts[1],
          body?.publication as never,
          body?.note ?? null,
          now
        )
      )
    }
    if ((req.method === "PUT" || req.method === "POST") && parts.length === 2) {
      const body = (await readBody(req)) as Record<string, unknown>
      return persist(
        res,
        upsert(
          db,
          parts[0],
          parts[1],
          body,
          now,
          req.method === "POST" ? "create" : "update"
        )
      )
    }
    send(res, 404, { errors: ["not found"] })
  } catch (e) {
    send(res, 400, { errors: [(e as Error).message] })
  }
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`管理画面: http://127.0.0.1:${PORT}/  (Ctrl+C で終了)`)
})
