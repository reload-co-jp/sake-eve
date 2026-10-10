import { Metadata } from "next"
import { SectionTitle } from "@/components/elements/layout"
import { ProductList } from "@/components/Lists"
import { db } from "@/lib/data"

export const metadata: Metadata = {
  title: "新商品・限定商品",
  description: "お酒の新商品・限定商品と、関連するイベント・記事。",
  alternates: { canonical: "/products/" },
}

const Page = () => (
  <div className="container page">
    <SectionTitle as="h1" en="Products" ja="新商品・限定商品" />
    <ProductList
      products={[...db.products].sort((a, b) =>
        (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "")
      )}
    />
  </div>
)

export default Page
