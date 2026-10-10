import Link from "next/link"
import { FC, ReactNode } from "react"
import { getProducer } from "@/lib/data"
import { formatDateTime } from "@/lib/event"
import {
  ARTICLE_TYPES,
  GENRES,
  PRODUCER_TYPES,
  type Article,
  type Genre,
  type Producer,
  type Product,
} from "@/lib/types"

const SampleBadge: FC<{ show: boolean }> = ({ show }) =>
  show ? <span className="badge badge-sample">サンプル</span> : null

const Genres: FC<{ genres: Genre[] }> = ({ genres }) => (
  <ul className="tags" aria-label="酒類ジャンル">
    {genres.map((g) => (
      <li key={g} className={`tag genre-${g}`}>
        {GENRES[g]}
      </li>
    ))}
  </ul>
)

const Grid: FC<{ children: ReactNode[] }> = ({ children }) => (
  <ul className="card-list">
    {children.map((c, i) => (
      <li key={i}>{c}</li>
    ))}
  </ul>
)

export const ArticleList: FC<{ articles: Article[] }> = ({ articles }) => (
  <Grid>
    {articles.map((a) => (
      <article key={a.id} className="card card--article">
        <p className="card-date">
          <SampleBadge show={a.isSample} />
          <span className="badge">{ARTICLE_TYPES[a.articleType]}</span>
          <time dateTime={a.publishedAt}>
            {formatDateTime(a.publishedAt).split(" ")[0]}
          </time>
        </p>
        <h3 className="card-title">
          <Link href={`/articles/${a.slug}/`}>{a.title}</Link>
        </h3>
        <p className="card-place">{a.summary}</p>
      </article>
    ))}
  </Grid>
)

export const ProducerList: FC<{ producers: Producer[] }> = ({ producers }) => (
  <Grid>
    {producers.map((p) => (
      <article key={p.id} className="card card--producer">
        <p className="card-date">
          <SampleBadge show={p.isSample} />
          <span className="badge">{PRODUCER_TYPES[p.producerType]}</span>
        </p>
        <h3 className="card-title">
          <Link href={`/producers/${p.slug}/`}>{p.name}</Link>
        </h3>
        <p className="card-place">所在地: {p.prefecture ?? "不明"}</p>
        <Genres genres={p.genres} />
      </article>
    ))}
  </Grid>
)

export const ProductList: FC<{ products: Product[] }> = ({ products }) => (
  <Grid>
    {products.map((p) => (
      <article key={p.id} className="card card--product">
        <p className="card-date">
          <SampleBadge show={p.isSample} />
          {p.releaseDate && (
            <span>発売日 {p.releaseDate.replaceAll("-", "/")}</span>
          )}
        </p>
        <h3 className="card-title">
          <Link href={`/products/${p.slug}/`}>{p.name}</Link>
        </h3>
        <p className="card-place">
          {getProducer(p.producerId)?.name ?? "メーカー不明"}
        </p>
        <Genres genres={p.genres} />
      </article>
    ))}
  </Grid>
)

/** Section that renders nothing when empty. */
export const Related: FC<{
  title: string
  id: string
  children: ReactNode
  empty: boolean
}> = ({ title, id, children, empty }) =>
  empty ? null : (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  )
