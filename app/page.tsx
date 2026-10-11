import { Metadata } from "next"
import Link from "next/link"
import { EventCard, StatusBadge, eventPlace } from "@/components/EventCard"
import { EventMap } from "@/components/EventMap"
import { SectionTitle } from "@/components/elements/layout"
import { ArticleList, ProducerList, ProductList } from "@/components/Lists"
import { db, publicEvents } from "@/lib/data"
import {
  byStartAt,
  effectiveStatus,
  formatPeriod,
  jstDate,
  toMapPoint,
} from "@/lib/event"
import {
  GENRES,
  GENRES_EN,
  PREFECTURE_SLUGS,
  REGIONS,
  type Genre,
} from "@/lib/types"

export const metadata: Metadata = { alternates: { canonical: "/" } }

// Built statically: "upcoming" is evaluated at build time, so rebuild on data updates.
const Page = () => {
  const upcoming = publicEvents
    .filter((e) => ["scheduled", "ongoing"].includes(effectiveStatus(e)))
    .sort(byStartAt)
  // Ongoing events sort first (earliest start), then the soonest scheduled ones.
  const featured = upcoming.slice(0, 3)
  const pickup = upcoming.slice(3, 9)
  const points = upcoming.map(toMapPoint).filter((p) => p !== null)
  const latest = [...publicEvents]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5)
  const reports = [...db.articles]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 3)
  const newProducts = [...db.products]
    .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""))
    .slice(0, 3)
  const countBy = (pred: (e: (typeof publicEvents)[number]) => boolean) =>
    publicEvents.filter(pred).length

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="container">
          <h1 id="hero-title" className="visually-hidden">
            お酒のイベントを、探す・知る・訪れる。
          </h1>
          <ul className="feature">
            {featured.map((e) => (
              <li key={e.id}>
                <Link className="feature__item" href={`/events/${e.slug}/`}>
                  {e.imageUrl && (
                    <img
                      className="feature__image"
                      src={e.imageUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span className="feature__body">
                    <span className="feature__date">
                      <StatusBadge event={e} />
                      <time dateTime={e.startAt ?? undefined}>
                        {formatPeriod(e)}
                      </time>
                    </span>
                    <span className="feature__title">{e.title}</span>
                    <span className="feature__place">{eventPlace(e)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="genre"
        className="band band--beige"
        aria-labelledby="genre-title"
      >
        <div className="container">
          <SectionTitle id="genre-title" en="Genre" ja="ジャンルから探す" />
          <ul className="genre-grid">
            {(Object.keys(GENRES) as Genre[]).map((g) => (
              <li key={g}>
                <Link
                  className={`genre-tile genre-${g}`}
                  href={`/genres/${g}/`}
                >
                  <span className="genre-tile__en" aria-hidden="true">
                    {GENRES_EN[g]}
                  </span>
                  <span className="genre-tile__ja">{GENRES[g]}</span>
                  <span className="genre-tile__count">
                    {countBy((e) => e.genres.includes(g))}件
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="center">
            <Link className="btn" href="/events/">
              イベント一覧を見る
            </Link>
          </p>
        </div>
      </section>

      {pickup.length > 0 && (
        <section className="band band--green" aria-labelledby="pickup-title">
          <div className="container">
            <SectionTitle
              id="pickup-title"
              en="Pickup"
              ja="近日開催のイベント"
            />
            <ul className="pickup">
              {pickup.map((e) => (
                <li key={e.id}>
                  <EventCard event={e} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="band" aria-labelledby="discover-title">
        <div className="container">
          <SectionTitle
            id="discover-title"
            en="Discover"
            ja="地図とタイムラインで探す"
          />
          {points.length > 0 && (
            <EventMap points={points} label="開催予定イベントの会場の地図" />
          )}
          <div className="discover">
            <Link className="discover__item" href="/events/map/">
              <span className="discover__en" aria-hidden="true">
                Map
              </span>
              <span className="discover__ja">地図で探す</span>
              <span className="discover__text">
                会場の場所から、近くで開かれるイベントを探せます。
              </span>
            </Link>
            <Link className="discover__item" href="/events/timeline/">
              <span className="discover__en" aria-hidden="true">
                Timeline
              </span>
              <span className="discover__ja">開催期間で比べる</span>
              <span className="discover__text">
                日・週・月の表示で、開催期間の重なりをひと目で確認できます。
              </span>
            </Link>
          </div>
        </div>
      </section>

      <section
        className="band band--beige band--zigzag"
        aria-labelledby="news-title"
      >
        <div className="container">
          <SectionTitle id="news-title" en="News" ja="新着イベント情報" />
          <ul className="news">
            {latest.map((e) => (
              <li key={e.id} className="news__item">
                <time className="news__date" dateTime={e.createdAt}>
                  {jstDate(e.createdAt).replaceAll("-", ".")}
                </time>
                <ul className="news__cats" aria-label="酒類ジャンル">
                  {e.genres.map((g) => (
                    <li key={g}>{GENRES[g]}</li>
                  ))}
                </ul>
                <Link className="news__title" href={`/events/${e.slug}/`}>
                  {e.title}
                </Link>
              </li>
            ))}
          </ul>
          <p className="center">
            <Link className="btn" href="/events/">
              一覧を見る
            </Link>
          </p>
        </div>
      </section>

      {reports.length > 0 && (
        <section className="band" aria-labelledby="report-title">
          <div className="container">
            <SectionTitle
              id="report-title"
              en="Report"
              ja="イベントレポート・記事"
            />
            <ArticleList articles={reports} />
            <p className="center">
              <Link className="btn" href="/articles/">
                記事一覧を見る
              </Link>
            </p>
          </div>
        </section>
      )}

      {db.producers.length > 0 && (
        <section className="band band--beige" aria-labelledby="producers-title">
          <div className="container">
            <SectionTitle
              id="producers-title"
              en="Producers"
              ja="出店する酒蔵・ブルワリー"
            />
            <ProducerList producers={db.producers.slice(0, 6)} />
            <p className="center">
              <Link className="btn" href="/producers/">
                事業者一覧を見る
              </Link>
            </p>
          </div>
        </section>
      )}

      {newProducts.length > 0 && (
        <section className="band" aria-labelledby="products-title">
          <div className="container">
            <SectionTitle
              id="products-title"
              en="Products"
              ja="新商品・限定商品"
            />
            <ProductList products={newProducts} />
            <p className="center">
              <Link className="btn" href="/products/">
                商品一覧を見る
              </Link>
            </p>
          </div>
        </section>
      )}

      <section
        id="concept"
        className="band band--dark"
        aria-labelledby="concept-title"
      >
        <div className="container center">
          <p className="concept__en" aria-hidden="true">
            Enjoy The Sake Days.
          </p>
          <h2 id="concept-title" className="concept__title">
            サケイベ！とは
          </h2>
          <p className="concept__text">
            サケイベ！は、全国のお酒のイベントを集めて紹介する情報メディアです。
            <br />
            ビアフェスから酒蔵開放、ワインの試飲会まで、
            <br />
            「行ってみたい」が見つかる場所を目指しています。
          </p>
          <p className="concept__note">
            掲載情報には出典と確認状態を明記しています。
          </p>
        </div>
      </section>

      <section
        id="area"
        className="band band--beige"
        aria-labelledby="area-title"
      >
        <div className="container">
          <SectionTitle id="area-title" en="Area" ja="エリアから探す" />
          <div className="area-grid">
            {REGIONS.map((r) => (
              <div key={r.name} className="area">
                <h3 className="area__name">{r.name}</h3>
                <ul className="area__list">
                  {r.prefectures.map((p) => {
                    const n = countBy((e) => e.venue.prefecture === p)
                    return (
                      <li key={p}>
                        <Link href={`/areas/${PREFECTURE_SLUGS[p]}/`}>
                          {p}
                          {n > 0 && (
                            <span className="area__count">（{n}）</span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

export default Page
