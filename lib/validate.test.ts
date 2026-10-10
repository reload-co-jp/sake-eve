import { describe, expect, it } from "vitest"
import articles from "@/data/articles.json"
import events from "@/data/events.json"
import producers from "@/data/producers.json"
import products from "@/data/products.json"
import sources from "@/data/sources.json"
import { validateDb } from "./validate"

const real = { events, sources, articles, producers, products }
const clone = () => structuredClone(real) as Record<keyof typeof real, any[]> // eslint-disable-line @typescript-eslint/no-explicit-any

describe("validateDb", () => {
  it("accepts data/*.json", () => {
    expect(validateDb(real)).toEqual([])
  })

  it.each([
    [
      "reversed dates",
      (d) => (d.events[0].endAt = "2026-01-01T00:00:00+09:00"),
      "endAtがstartAtより前",
    ],
    [
      "date without timezone",
      (d) => (d.events[0].startAt = "2026-10-17T11:00:00"),
      "startAt",
    ],
    [
      "invalid url",
      (d) => (d.events[0].officialUrl = "javascript:alert(1)"),
      "officialUrl",
    ],
    [
      "latitude out of range",
      (d) => (d.events[0].venue.latitude = 91),
      "latitude",
    ],
    [
      "half coordinates",
      (d) => (d.events[0].venue.longitude = null),
      "緯度・経度",
    ],
    [
      "missing reference",
      (d) => d.events[0].sourceIds.push("src-nope"),
      "src-nope",
    ],
    ["unknown genre", (d) => (d.events[0].genres = ["juice"]), "genres"],
    [
      "duplicate slug",
      (d) => (d.events[1].slug = d.events[0].slug),
      "重複slug",
    ],
    ["omitted field", (d) => delete d.events[0].ticketUrl, "ticketUrl"],
    [
      "published while needing review",
      (d) => (d.events[0].verificationStatus = "needs_review"),
      "公開できない",
    ],
    [
      "duplicate producer name",
      (d) => (d.producers[1].aliases = [d.producers[0].name]),
      "重複の可能性",
    ],
    [
      "unknown prefecture",
      (d) => (d.events[0].venue.prefecture = "東京"),
      "prefecture",
    ],
  ] as [string, (d: ReturnType<typeof clone>) => void, string][])(
    "detects %s",
    (_, mutate, expected) => {
      const d = clone()
      mutate(d)
      const errors = validateDb(d)
      expect(errors.join("\n")).toContain(expected)
    }
  )
})
