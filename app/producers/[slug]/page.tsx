import { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { EventList } from "@/components/EventCard"
import { ArticleList, ProductList, Related } from "@/components/Lists"
import {
  db,
  getProducerBySlug,
  producerRelations,
  staticSlugs,
} from "@/lib/data"
import { effectiveStatus } from "@/lib/event"
import { GENRES, PRODUCER_TYPES } from "@/lib/types"

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false
export const generateStaticParams = () => staticSlugs(db.producers)

export const generateMetadata = async ({
  params,
}: Props): Promise<Metadata> => {
  const p = getProducerBySlug((await params).slug)
  if (!p) return {}
  return {
    title: p.name,
    description: `${p.name}（${PRODUCER_TYPES[p.producerType]}・${p.prefecture ?? "所在地不明"}）の参加イベント、商品、記事。`,
    alternates: { canonical: `/producers/${p.slug}/` },
  }
}

const Page = async ({ params }: Props) => {
  const p = getProducerBySlug((await params).slug)
  if (!p) notFound()
  const { events, products, articles } = producerRelations(p)
  const past = events.filter((e) => effectiveStatus(e) === "ended")
  const upcoming = events.filter((e) => effectiveStatus(e) !== "ended")
  return (
    <article className="container page detail">
      <p>
        <Link href="/producers/">← 事業者一覧へ</Link>
      </p>
      <p className="card-date">
        {p.isSample && <span className="badge badge-sample">サンプル</span>}
        <span className="badge">{PRODUCER_TYPES[p.producerType]}</span>
      </p>
      <h1 className="page-title">{p.name}</h1>
      <section aria-labelledby="info">
        <h2 id="info">基本情報</h2>
        <dl className="info">
          <dt>別名</dt>
          <dd>{p.aliases.length ? p.aliases.join("、") : "なし"}</dd>
          {/* Producer location, never to be confused with event venues. */}
          <dt>所在地</dt>
          <dd>
            {[p.prefecture, p.address].filter(Boolean).join(" ") || "不明"}
          </dd>
          <dt>製造する酒類</dt>
          <dd>{p.genres.map((g) => GENRES[g]).join("、")}</dd>
          <dt>公式サイト</dt>
          <dd>
            {p.officialUrl ? (
              <a href={p.officialUrl} target="_blank" rel="noopener noreferrer">
                {p.officialUrl}
              </a>
            ) : (
              "不明"
            )}
          </dd>
        </dl>
      </section>
      <Related
        title="代表商品・ブランド"
        id="products"
        empty={!products.length}
      >
        <ProductList products={products} />
      </Related>
      <Related
        title="参加予定のイベント"
        id="upcoming"
        empty={!upcoming.length}
      >
        <EventList events={upcoming} />
      </Related>
      <Related title="過去の参加実績" id="past" empty={!past.length}>
        <EventList events={past} />
      </Related>
      <Related
        title="関連する記事・訪問レポート"
        id="articles"
        empty={!articles.length}
      >
        <ArticleList articles={articles} />
      </Related>
    </article>
  )
}

export default Page
