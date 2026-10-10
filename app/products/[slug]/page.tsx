import { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { EventList } from "@/components/EventCard"
import { ArticleList, Related } from "@/components/Lists"
import {
  db,
  getProducer,
  getProductBySlug,
  productRelations,
  staticSlugs,
} from "@/lib/data"
import { formatDateTime } from "@/lib/event"
import { GENRES, SOURCE_TYPES } from "@/lib/types"

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false
export const generateStaticParams = () => staticSlugs(db.products)

export const generateMetadata = async ({
  params,
}: Props): Promise<Metadata> => {
  const p = getProductBySlug((await params).slug)
  if (!p) return {}
  return {
    title: p.name,
    description: p.description ?? `${p.name}の商品情報と関連イベント・記事。`,
    alternates: { canonical: `/products/${p.slug}/` },
  }
}

const Page = async ({ params }: Props) => {
  const p = getProductBySlug((await params).slug)
  if (!p) notFound()
  const producer = getProducer(p.producerId)
  const { events, articles, sources } = productRelations(p)
  return (
    <article className="container page detail">
      <p>
        <Link href="/products/">← 商品一覧へ</Link>
      </p>
      {p.isSample && (
        <p className="card-date">
          <span className="badge badge-sample">サンプル</span>
        </p>
      )}
      <h1 className="page-title">{p.name}</h1>
      {p.description && <p className="lead">{p.description}</p>}
      <section aria-labelledby="info">
        <h2 id="info">商品情報</h2>
        <dl className="info">
          <dt>メーカー</dt>
          <dd>
            {producer ? (
              <Link href={`/producers/${producer.slug}/`}>{producer.name}</Link>
            ) : (
              "不明"
            )}
          </dd>
          <dt>酒類ジャンル</dt>
          <dd>{p.genres.map((g) => GENRES[g]).join("、")}</dd>
          <dt>発売日</dt>
          <dd>{p.releaseDate?.replaceAll("-", "/") ?? "不明"}</dd>
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
        title="この商品が登場するイベント"
        id="events"
        empty={!events.length}
      >
        <EventList events={events} />
      </Related>
      <Related title="関連記事" id="articles" empty={!articles.length}>
        <ArticleList articles={articles} />
      </Related>
      <section aria-labelledby="sources">
        <h2 id="sources">情報源と確認状況</h2>
        {sources.length ? (
          <ul className="sources">
            {sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
                <br />
                <small>
                  {SOURCE_TYPES[s.sourceType]} ／ 取得{" "}
                  {formatDateTime(s.fetchedAt)}
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {p.isSample
              ? "サンプルデータのため出典はありません。"
              : "出典未登録（未確認）"}
          </p>
        )}
      </section>
    </article>
  )
}

export default Page
