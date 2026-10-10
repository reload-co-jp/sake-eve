import { Metadata } from "next"
import { SectionTitle } from "@/components/elements/layout"
import { EventArchive } from "@/components/EventArchive"
import { publicEvents } from "@/lib/data"
import { PREFECTURE_BY_SLUG, PREFECTURE_SLUGS } from "@/lib/types"

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
  return {
    title: `${pref}のお酒イベント`,
    description: `${pref}で開催されるビール・ワイン・日本酒などお酒のイベント一覧。`,
    alternates: { canonical: `/areas/${prefecture}/` },
    // Avoid indexing thin pages for prefectures without events.
    robots: eventsIn(pref).length ? undefined : { index: false },
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
