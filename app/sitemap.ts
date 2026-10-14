import type { MetadataRoute } from "next"
import { db, publicEvents } from "@/lib/data"
import { SITE_URL } from "@/lib/seo"
import { GENRES, PREFECTURE_SLUGS } from "@/lib/types"

export const dynamic = "force-static"

// Query-string search pages are excluded on purpose (no duplicate pages per filter combination).
const sitemap = (): MetadataRoute.Sitemap => {
  const withEvents = new Set(publicEvents.map((e) => e.venue.prefecture))
  const genresWithEvents = new Set(publicEvents.flatMap((e) => e.genres))
  const lastModified = new Map<string, string>([
    ...publicEvents.map((e) => [`/events/${e.slug}/`, e.updatedAt] as const),
    ...db.articles.map((a) => [`/articles/${a.slug}/`, a.updatedAt] as const),
  ])
  const paths = [
    "/",
    "/events/",
    "/events/map/",
    "/events/timeline/",
    "/articles/",
    "/producers/",
    "/products/",
    ...publicEvents.map((e) => `/events/${e.slug}/`),
    ...db.articles.map((a) => `/articles/${a.slug}/`),
    ...db.producers.map((p) => `/producers/${p.slug}/`),
    ...db.products.map((p) => `/products/${p.slug}/`),
    ...Object.entries(PREFECTURE_SLUGS)
      .filter(([pref]) => withEvents.has(pref))
      .map(([, slug]) => `/areas/${slug}/`),
    ...Object.keys(GENRES)
      .filter((g) => genresWithEvents.has(g as never))
      .map((g) => `/genres/${g}/`),
  ]
  return paths.map((p) => ({
    url: `${SITE_URL}${p}`,
    lastModified: lastModified.get(p),
  }))
}

export default sitemap
