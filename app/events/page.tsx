import { Metadata } from "next"
import { Suspense } from "react"
import { eventSearchText, publicEvents } from "@/lib/data"
import { SectionTitle } from "@/components/elements/layout"
import { EventSearch } from "./EventSearch"

export const metadata: Metadata = {
  title: "イベントを探す",
  alternates: { canonical: "/events/" },
  description:
    "ビール・ワイン・ウイスキー・日本酒など、お酒のイベントをキーワード・都道府県・開催期間・ジャンルで検索。",
}

const Page = () => (
  <div className="container page">
    <SectionTitle as="h1" en="Events" ja="イベントを探す" />
    <Suspense fallback={<p>読み込み中…</p>}>
      <EventSearch events={publicEvents} extraText={eventSearchText} />
    </Suspense>
  </div>
)

export default Page
