import { Metadata } from "next"
import { SectionTitle } from "@/components/elements/layout"
import { ProducerList } from "@/components/Lists"
import { db } from "@/lib/data"
import { PRODUCER_TYPES, type ProducerType } from "@/lib/types"

export const metadata: Metadata = {
  title: "酒蔵・ブルワリー・ワイナリー",
  description:
    "お酒のイベントに出店する酒蔵、ブルワリー、ワイナリー、蒸留所の一覧。",
  alternates: { canonical: "/producers/" },
}

const Page = () => (
  <div className="container page">
    <SectionTitle as="h1" en="Producers" ja="酒蔵・ブルワリー" />
    {(Object.keys(PRODUCER_TYPES) as ProducerType[]).map((t) => {
      const list = db.producers.filter((p) => p.producerType === t)
      return list.length ? (
        <section key={t} aria-labelledby={`type-${t}`}>
          <h2 id={`type-${t}`}>{PRODUCER_TYPES[t]}</h2>
          <ProducerList producers={list} />
        </section>
      ) : null
    })}
  </div>
)

export default Page
