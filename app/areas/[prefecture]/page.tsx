import { Metadata } from "next"
import { SectionTitle } from "@/components/elements/layout"
import { EventArchive } from "@/components/EventArchive"
import { publicEvents } from "@/lib/data"
import { GENRES, PREFECTURE_BY_SLUG, PREFECTURE_SLUGS } from "@/lib/types"

type Props = { params: Promise<{ prefecture: string }> }

export const dynamicParams = false
export const generateStaticParams = () =>
  Object.values(PREFECTURE_SLUGS).map((prefecture) => ({ prefecture }))

const eventsIn = (pref: string) =>
  publicEvents.filter((e) => e.venue.prefecture === pref)

export const generateMetadata = async ({
  params,
}: Props): Promise<Metadata> => {
  const { prefecture } = await params
  const pref = PREFECTURE_BY_SLUG[prefecture]
  const events = eventsIn(pref)
  // Genres actually held here, so titles match searches like "東京 日本酒 イベント".
  const genres = [...new Set(events.flatMap((e) => e.genres))]
    .filter((g) => g !== "other")
    .map((g) => GENRES[g])
  const genreLabel = genres.length ? genres.slice(0, 3).join("・") : "お酒"
  return {
    title: `${pref}のお酒イベント・フェス情報（${genreLabel}）`,
    description: `${pref}で開催される${genres.join("・") || "お酒"}のイベント・試飲会・フェス${events.length}件を掲載。日程・会場を一覧で確認できます。`,
    alternates: { canonical: `/areas/${prefecture}/` },
    // Avoid indexing thin pages for prefectures without events.
    robots: events.length ? undefined : { index: false },
  }
}

const Page = async ({ params }: Props) => {
  const pref = PREFECTURE_BY_SLUG[(await params).prefecture]
  return (
    <div className="container page">
      <SectionTitle as="h1" en="Area" ja={`${pref}のお酒イベント`} />
      <EventArchive
        events={eventsIn(pref)}
        searchHref={`/events/?pref=${encodeURIComponent(pref)}`}
      />
    </div>
  )
}

export default Page
