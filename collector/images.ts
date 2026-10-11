/**
 * Download hotlinked images of published events into public/images/events/
 * as resized WebP and point imageUrl at the local copy.
 *
 *   node collector/images.ts
 */
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import sharp from "sharp"
import { writeJson } from "./store.ts"

const WIDTH = 1000

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
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(join(dir, `${e.id}.webp`))
    e.imageUrl = `/images/events/${e.id}.webp`
    saved++
  } catch (err) {
    console.error(`${e.id}: ${err}`)
  }
  await new Promise((r) => setTimeout(r, config.requestIntervalMs))
}
writeJson(path, events)
console.log(`saved ${saved} images`)
