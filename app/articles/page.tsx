import { Metadata } from "next"
import { SectionTitle } from "@/components/elements/layout"
import { ArticleList } from "@/components/Lists"
import { db } from "@/lib/data"

export const metadata: Metadata = {
  title: "記事・レポート",
  description: "お酒のイベント紹介、開催レポート、出店者・新商品の紹介記事。",
  alternates: { canonical: "/articles/" },
}

const Page = () => (
  <div className="container page">
    <SectionTitle as="h1" en="Articles" ja="記事・レポート" />
    <ArticleList
      articles={[...db.articles].sort((a, b) =>
        b.publishedAt.localeCompare(a.publishedAt)
      )}
    />
  </div>
)

export default Page
