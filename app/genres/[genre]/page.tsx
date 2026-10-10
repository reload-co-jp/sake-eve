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
  return {
    title: `${GENRES[genre]}のイベント`,
    description: `${GENRES[genre]}に関するイベント・試飲会・フェスの一覧。`,
    alternates: { canonical: `/genres/${genre}/` },
    robots: eventsOf(genre).length ? undefined : { index: false },
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
