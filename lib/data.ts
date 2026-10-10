import articles from "@/data/articles.json"
import events from "@/data/events.json"
import producers from "@/data/producers.json"
import products from "@/data/products.json"
import sources from "@/data/sources.json"
import { byStartAt, effectiveStatus } from "./event"
import type { Article, Db, Event, Producer, Product } from "./types"
import { validateDb } from "./validate"

const raw = { events, sources, articles, producers, products }

// Invalid data must fail the build instead of shipping broken pages.
const errors = validateDb(raw)
if (errors.length > 0) {
  throw new Error(
    `データ検証エラー (${errors.length}件):\n${errors.join("\n")}`
  )
}

export const db = raw as unknown as Db

/** Events shown on the site: only those approved for publication. */
export const publicEvents = db.events.filter(
  (e) => e.publication === "published"
)

export const getEventBySlug = (slug: string) =>
  publicEvents.find((e) => e.slug === slug)

export const getSources = (ids: string[]) =>
  db.sources.filter((s) => ids.includes(s.id))

const byIds = <T extends { id: string }>(items: T[], ids: string[]) =>
  items.filter((x) => ids.includes(x.id))

/** Relations are stored on both sides; read either side so one-sided links still show. */
const linked = <T extends { id: string }>(
  items: T[],
  ownIds: string[],
  backRef: (x: T) => string[],
  selfId: string
) => items.filter((x) => ownIds.includes(x.id) || backRef(x).includes(selfId))

export const getArticleBySlug = (slug: string) =>
  db.articles.find((a) => a.slug === slug)
export const getProducerBySlug = (slug: string) =>
  db.producers.find((p) => p.slug === slug)
export const getProductBySlug = (slug: string) =>
  db.products.find((p) => p.slug === slug)
export const getProducer = (id: string | null) =>
  db.producers.find((p) => p.id === id)

export const eventRelations = (e: Event) => ({
  producers: linked(db.producers, e.producerIds, (p) => p.eventIds, e.id),
  products: linked(db.products, e.productIds, (p) => p.eventIds, e.id),
  articles: linked(db.articles, e.articleIds, (a) => a.eventIds, e.id),
})

export const articleRelations = (a: Article) => ({
  events: linked(publicEvents, a.eventIds, (e) => e.articleIds, a.id),
  producers: linked(db.producers, a.producerIds, (p) => p.articleIds, a.id),
  products: linked(db.products, a.productIds, (p) => p.articleIds, a.id),
})

export const producerRelations = (p: Producer) => ({
  events: linked(publicEvents, p.eventIds, (e) => e.producerIds, p.id),
  products: linked(
    db.products,
    p.productIds,
    (x) => (x.producerId ? [x.producerId] : []),
    p.id
  ),
  articles: linked(db.articles, p.articleIds, (a) => a.producerIds, p.id),
})

export const productRelations = (p: Product) => ({
  events: linked(publicEvents, p.eventIds, (e) => e.productIds, p.id),
  articles: linked(db.articles, p.articleIds, (a) => a.productIds, p.id),
  sources: byIds(db.sources, p.sourceIds),
})

/** Producer/product names per event, so keyword search also finds exhibitors and products. */
export const eventSearchText: Record<string, string> = Object.fromEntries(
  publicEvents.map((e) => {
    const { producers, products } = eventRelations(e)
    return [
      e.id,
      [
        ...producers.flatMap((p) => [p.name, ...p.aliases]),
        ...products.map((p) => p.name),
      ].join(" "),
    ]
  })
)

/** Same prefecture or genre, upcoming first. */
export const relatedEvents = (e: Event, limit = 4) =>
  publicEvents
    .filter(
      (o) =>
        o.id !== e.id &&
        (o.venue.prefecture === e.venue.prefecture ||
          o.genres.some((g) => e.genres.includes(g)))
    )
    .map((o) => ({ o, ended: effectiveStatus(o) === "ended" }))
    .sort((a, b) => Number(a.ended) - Number(b.ended) || byStartAt(a.o, b.o))
    .slice(0, limit)
    .map(({ o }) => o)

// output: "export" rejects an empty generateStaticParams; the placeholder slug renders notFound().
export const staticSlugs = (items: { slug: string }[]) =>
  items.length ? items.map(({ slug }) => ({ slug })) : [{ slug: "_" }]
