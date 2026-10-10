import { Metadata } from "next"
import { Suspense } from "react"
import { SectionTitle } from "@/components/elements/layout"
import { eventSearchText, publicEvents } from "@/lib/data"
import { TimelineView } from "./TimelineView"

export const metadata: Metadata = {
  title: "タイムラインでイベントを探す",
  description:
    "お酒のイベントの開催期間をガントチャート風に比較できます。日・週・月で表示切替。",
  alternates: { canonical: "/events/timeline/" },
}

const Page = () => (
  <div className="container page">
    <SectionTitle as="h1" en="Timeline" ja="開催期間で比べる" />
    <Suspense fallback={<p>読み込み中…</p>}>
      <TimelineView events={publicEvents} extraText={eventSearchText} />
    </Suspense>
  </div>
)

export default Page
