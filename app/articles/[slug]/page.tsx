import { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { EventList } from "@/components/EventCard"
import { ProducerList, ProductList, Related } from "@/components/Lists"
import { articleRelations, db, getArticleBySlug, getSources } from "@/lib/data"
import { formatDateTime } from "@/lib/event"
import { ARTICLE_TYPES } from "@/lib/types"

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false
export const generateStaticParams = () =>
  db.articles.map((a) => ({ slug: a.slug }))

export const generateMetadata = async ({
  params,
}: Props): Promise<Metadata> => {
  const a = getArticleBySlug((await params).slug)!
  return {
    title: a.title,
    description: a.summary,
    alternates: { canonical: `/articles/${a.slug}/` },
  }
}

const Page = async ({ params }: Props) => {
  const a = getArticleBySlug((await params).slug)
  if (!a) notFound()
  const { events, producers, products } = articleRelations(a)
  const sources = getSources(a.sourceIds)
  return (
    <article className="container page detail">
      <p>
        <Link href="/articles/">← 記事一覧へ</Link>
      </p>
      <p className="card-date">
        {a.isSample && <span className="badge badge-sample">サンプル</span>}
        <span className="badge">{ARTICLE_TYPES[a.articleType]}</span>
        <time dateTime={a.publishedAt}>{formatDateTime(a.publishedAt)}</time>
      </p>
      <h1 className="page-title">{a.title}</h1>
      <p className="lead">{a.summary}</p>
      <div className="prose">
        {a.body.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>
      {a.updatedAt !== a.publishedAt && (
        <p className="note">最終更新: {formatDateTime(a.updatedAt)}</p>
      )}
      <Related title="この記事のイベント" id="events" empty={!events.length}>
        <EventList events={events} />
      </Related>
      <Related title="登場する事業者" id="producers" empty={!producers.length}>
        <ProducerList producers={producers} />
      </Related>
      <Related title="紹介した商品" id="products" empty={!products.length}>
        <ProductList products={products} />
      </Related>
      <Related title="出典" id="sources" empty={!sources.length}>
        <ul className="sources">
          {sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </Related>
    </article>
  )
}

export default Page
