import type { MetadataRoute } from "next"
import { articleRelations, db, publicEvents } from "@/lib/data"
import { isIndexableListing, isSitemapEvent, SITE_URL } from "@/lib/seo"
import { GENRES, PREFECTURE_SLUGS, type Event } from "@/lib/types"

export const dynamic = "force-static"

const latest = (events: Event[]) =>
  events
    .map((e) => e.updatedAt)
    .sort()
    .at(-1)

// Query-string search pages are excluded on purpose (no duplicate pages per filter combination).
// Only pages with current value are listed so crawl budget goes to them: ended events,
// guides for ended events and area/genre pages without upcoming events stay published
// (and internally linked) but are not pushed here.
const sitemap = (): MetadataRoute.Sitemap => {
  const now = new Date()
  const events = publicEvents.filter((e) => isSitemapEvent(e, now))
  const articles = db.articles.filter((a) => {
    const related = articleRelations(a).events
    return !related.length || related.some((e) => isSitemapEvent(e, now))
  })
  const byPref = Map.groupBy(publicEvents, (e) => e.venue.prefecture)
  const areas = Object.entries(PREFECTURE_SLUGS).flatMap(([pref, slug]) => {
    const list = byPref.get(pref) ?? []
    return isIndexableListing(list, now)
      ? [{ path: `/areas/${slug}/`, lastModified: latest(list) }]
      : []
  })
  const genres = Object.keys(GENRES).flatMap((g) => {
    const list = publicEvents.filter((e) => e.genres.includes(g as never))
    return isIndexableListing(list, now)
      ? [{ path: `/genres/${g}/`, lastModified: latest(list) }]
      : []
  })
  const allLatest = latest(publicEvents)
  const entries: { path: string; lastModified?: string }[] = [
    { path: "/", lastModified: allLatest },
    { path: "/events/", lastModified: allLatest },
    { path: "/events/map/", lastModified: allLatest },
    { path: "/events/timeline/", lastModified: allLatest },
    { path: "/articles/" },
    // Empty list pages are thin content; list them only once they have entries.
    ...(db.producers.length ? [{ path: "/producers/" }] : []),
    ...(db.products.length ? [{ path: "/products/" }] : []),
    ...events.map((e) => ({
      path: `/events/${e.slug}/`,
      lastModified: e.updatedAt,
    })),
    ...articles.map((a) => ({
      path: `/articles/${a.slug}/`,
      lastModified: a.updatedAt,
    })),
    ...db.producers.map((p) => ({ path: `/producers/${p.slug}/` })),
    ...db.products.map((p) => ({ path: `/products/${p.slug}/` })),
    ...areas,
    ...genres,
  ]
  return entries.map(({ path, lastModified }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
  }))
}

export default sitemap
