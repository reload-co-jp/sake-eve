import { Metadata } from "next"
import { SectionTitle } from "@/components/elements/layout"
import { EventArchive } from "@/components/EventArchive"
import { publicEvents } from "@/lib/data"
import { GENRES, GENRES_EN, type Genre } from "@/lib/types"

type Props = { params: Promise<{ genre: Genre }> }

export const dynamicParams = false
export const generateStaticParams = () =>
  Object.keys(GENRES).map((genre) => ({ genre }))

const eventsOf = (g: Genre) => publicEvents.filter((e) => e.genres.includes(g))

export const generateMetadata = async ({
  params,
}: Props): Promise<Metadata> => {
  const { genre } = await params
  const events = eventsOf(genre)
  const prefs = [
    ...new Set(events.map((e) => e.venue.prefecture).filter(Boolean)),
  ]
  return {
    title: `${GENRES[genre]}イベント・試飲会・フェス情報`,
    description: `${GENRES[genre]}のイベント・試飲会・フェス${events.length}件を掲載${prefs.length ? `（${prefs.slice(0, 5).join("・")}など）` : ""}。日程・会場を一覧で確認できます。`,
    alternates: { canonical: `/genres/${genre}/` },
    robots: events.length ? undefined : { index: false },
  }
}

const Page = async ({ params }: Props) => {
  const { genre } = await params
  return (
    <div className="container page">
      <SectionTitle
        as="h1"
        en={GENRES_EN[genre]}
        ja={`${GENRES[genre]}のイベント`}
      />
      <EventArchive
        events={eventsOf(genre)}
        searchHref={`/events/?genre=${genre}`}
      />
    </div>
  )
}

export default Page
