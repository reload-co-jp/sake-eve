import { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { EventList, GenreTags, StatusBadge } from "@/components/EventCard"
import { EventMap } from "@/components/EventMap"
import { ArticleList, ProductList, Related } from "@/components/Lists"
import {
  eventRelations,
  getEventBySlug,
  getSources,
  publicEvents,
  relatedEvents,
} from "@/lib/data"
import {
  effectiveStatus,
  formatDateTime,
  formatPeriod,
  toMapPoint,
} from "@/lib/event"
import { eventJsonLd, jsonLdHtml } from "@/lib/seo"
import {
  EVENT_TYPES,
  PRODUCER_TYPES,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
  type Event,
} from "@/lib/types"

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false
export const generateStaticParams = () =>
  publicEvents.map((e) => ({ slug: e.slug }))

export const generateMetadata = async ({
  params,
}: Props): Promise<Metadata> => {
  const event = getEventBySlug((await params).slug)
  return {
    title: event.title,
    description:
      `${formatPeriod(event)}／${event.venue.prefecture ?? "開催地未定"}。${event.description ?? ""}`.slice(
        0,
        120
      ),
    alternates: { canonical: `/events/${event.slug}/` },
  }
}

const Row = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) => (
  <>
    <dt>{label}</dt>
    <dd>{children ?? "不明"}</dd>
  </>
)

const ExtLink = ({ href }: { href: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {href}
    <span className="visually-hidden">（新しいタブで開く）</span>
  </a>
)

/** Plan vs. record for exhibitors, derived from the event's state. */
const participation = (e: Event) =>
  effectiveStatus(e) === "ended"
    ? "過去の開催実績"
    : e.verificationStatus === "verified"
      ? "出店確認済み"
      : "出店予定"

const yesNo = (v: boolean | null, yes: string, no: string) =>
  v === null ? null : v ? yes : no

const Page = async ({ params }: Props) => {
  const event = getEventBySlug((await params).slug)
  if (!event) notFound()
  const { venue } = event
  const sources = getSources(event.sourceIds)
  const { producers, products, articles } = eventRelations(event)
  const related = relatedEvents(event)
  const point = toMapPoint(event)
  const jsonLd = eventJsonLd(event)

  return (
    <article className="container page detail">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}
        />
      )}
      <p>
        <Link href="/events/">← イベント一覧へ</Link>
      </p>
      <header className="detail-head">
        <p className="card-date">
          <StatusBadge event={event} />
          <time dateTime={event.startAt ?? undefined}>
            {formatPeriod(event)}
          </time>
        </p>
        <h1 className="page-title">{event.title}</h1>
        <GenreTags event={event} />
      </header>

      {event.isSample && (
        <p className="note">
          これは動作確認用のサンプルデータです。実在のイベントではありません。
        </p>
      )}
      {event.description ? (
        <p className="lead">{event.description}</p>
      ) : (
        <p className="lead">概要は下記の出典（原典）でご確認ください。</p>
      )}

      <section aria-labelledby="info">
        <h2 id="info">開催情報</h2>
        <dl className="info">
          <Row label="開催日時">{formatPeriod(event)}</Row>
          <Row label="会場">{venue.name}</Row>
          <Row label="住所">{venue.address}</Row>
          <Row label="エリア">
            {[venue.prefecture, venue.city].filter(Boolean).join(" ") || null}
          </Row>
          <Row label="イベント形式">
            {event.eventTypes.map((t) => EVENT_TYPES[t]).join("、")}
          </Row>
          <Row label="主催者">{event.organizer}</Row>
          <Row label="公式サイト">
            {event.officialUrl && <ExtLink href={event.officialUrl} />}
          </Row>
          <Row label="入場料">
            {event.price ?? yesNo(event.isFree, "無料", "有料")}
          </Row>
          <Row label="予約">
            {yesNo(event.reservationRequired, "要予約", "予約不要")}
          </Row>
          <Row label="チケット">
            {event.ticketUrl && <ExtLink href={event.ticketUrl} />}
          </Row>
        </dl>
      </section>

      {point && (
        <section aria-labelledby="map">
          <h2 id="map">会場の地図</h2>
          <EventMap points={[point]} label={`${venue.name ?? "会場"}の地図`} />
        </section>
      )}

      <Related
        title="出店者・ブランド"
        id="producers"
        empty={!producers.length}
      >
        <ul className="compact-list">
          {producers.map((p) => (
            <li key={p.id}>
              <Link href={`/producers/${p.slug}/`}>{p.name}</Link>
              <span>
                {PRODUCER_TYPES[p.producerType]} ／ {participation(event)}
              </span>
            </li>
          ))}
        </ul>
      </Related>
      <Related
        title="提供予定・限定商品"
        id="products"
        empty={!products.length}
      >
        <ProductList products={products} />
      </Related>
      <Related
        title="紹介記事・レポート"
        id="articles"
        empty={!articles.length}
      >
        <ArticleList articles={articles} />
      </Related>

      <section aria-labelledby="sources">
        <h2 id="sources">出典と情報確認</h2>
        <p>
          確認状態:{" "}
          <strong>{VERIFICATION_STATUSES[event.verificationStatus]}</strong>／
          最終確認日時:{" "}
          {event.lastVerifiedAt
            ? formatDateTime(event.lastVerifiedAt)
            : "未確認"}
        </p>
        <ul className="sources">
          {sources.map((s) => (
            <li key={s.id}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.title}
                <span className="visually-hidden">（新しいタブで開く）</span>
              </a>
              <br />
              <small>
                {SOURCE_TYPES[s.sourceType]}
                {s.publisher && ` ／ ${s.publisher}`}
                {s.publishedAt && ` ／ 公開 ${formatDateTime(s.publishedAt)}`}
                {` ／ 取得 ${formatDateTime(s.fetchedAt)}`}
              </small>
            </li>
          ))}
        </ul>
        <p className="note">
          掲載情報は変更される場合があります。お出かけ前に必ず公式情報をご確認ください。
        </p>
      </section>

      <Related
        title="同じ地域・ジャンルのイベント"
        id="related"
        empty={!related.length}
      >
        <EventList events={related} />
      </Related>
    </article>
  )
}

export default Page
