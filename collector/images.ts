/**
 * Download hotlinked images of published events into public/images/events/
 * and point imageUrl at the local copy.
 *
 *   node collector/images.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { writeJson } from "./store.ts"

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
}

const root = join(import.meta.dirname, "..")
const config = JSON.parse(
  readFileSync(join(import.meta.dirname, "config.json"), "utf8")
)
const path = join(root, "data/events.json")
const dir = join(root, "public/images/events")
const events = JSON.parse(readFileSync(path, "utf8"))
mkdirSync(dir, { recursive: true })

let saved = 0
for (const e of events) {
  if (e.publication !== "published" || !/^https?:/.test(e.imageUrl ?? ""))
    continue
  try {
    const res = await fetch(e.imageUrl, {
      headers: { "User-Agent": config.userAgent },
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    const ext = EXT[res.headers.get("content-type")?.split(";")[0] ?? ""]
    if (!res.ok || !ext) throw new Error(`HTTP ${res.status} ${ext ?? ""}`)
    writeFileSync(
      join(dir, `${e.id}.${ext}`),
      Buffer.from(await res.arrayBuffer())
    )
    e.imageUrl = `/images/events/${e.id}.${ext}`
    saved++
  } catch (err) {
    console.error(`${e.id}: ${err}`)
  }
  await new Promise((r) => setTimeout(r, config.requestIntervalMs))
}
writeJson(path, events)
console.log(`saved ${saved} images`)
