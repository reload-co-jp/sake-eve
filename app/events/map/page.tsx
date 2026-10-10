import { Metadata } from "next"
import { Suspense } from "react"
import { SectionTitle } from "@/components/elements/layout"
import { eventSearchText, publicEvents } from "@/lib/data"
import { MapView } from "./MapView"

export const metadata: Metadata = {
  title: "地図でイベントを探す",
  description:
    "お酒のイベント会場を地図で探せます。都道府県・期間・ジャンルで絞り込み可能。",
  alternates: { canonical: "/events/map/" },
}

const Page = () => (
  <div className="container page">
    <SectionTitle as="h1" en="Map" ja="地図で探す" />
    <Suspense fallback={<p>読み込み中…</p>}>
      <MapView events={publicEvents} extraText={eventSearchText} />
    </Suspense>
  </div>
)

export default Page
