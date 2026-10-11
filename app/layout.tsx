import { Metadata } from "next"
import { Inknut_Antiqua, Zen_Old_Mincho } from "next/font/google"
import Link from "next/link"
import { Footer, Header, Main } from "@/components/elements/layout"
import { OPEN_GRAPH_BASE, SITE_URL } from "@/lib/seo"
import { GENRES } from "@/lib/types"
import "./reset.css"
import "./globals.css"

const mincho = Zen_Old_Mincho({
  weight: ["500", "700"],
  subsets: ["latin"],
  preload: false,
  variable: "--font-mincho",
})
const display = Inknut_Antiqua({
  weight: ["500"],
  subsets: ["latin"],
  variable: "--font-display",
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "サケイベ！ お酒のイベントを探す",
    template: "%s | サケイベ！",
  },
  description:
    "サケイベ！はビール、ワイン、ウイスキー、日本酒などお酒のイベントを探せる情報メディアです。",
  openGraph: OPEN_GRAPH_BASE,
  twitter: { card: "summary_large_image" },
}

const NAV = [
  { href: "/events/", en: "Events", ja: "イベントを探す" },
  { href: "/events/map/", en: "Map", ja: "地図" },
  { href: "/events/timeline/", en: "Timeline", ja: "タイムライン" },
  { href: "/articles/", en: "Articles", ja: "記事" },
  { href: "/producers/", en: "Producers", ja: "酒蔵・醸造所" },
]
const FOOTER_NAV = [
  ...NAV,
  { href: "/products/", en: "Products", ja: "新商品" },
  { href: "/#area", en: "Area", ja: "エリアから探す" },
  { href: "/#concept", en: "About", ja: "サケイベ！とは" },
]

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="ja" className={`${mincho.variable} ${display.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          本文へスキップ
        </a>
        <Header>
          <p className="logo-wrap">
            <Link href="/" className="logo">
              サケイベ！
            </Link>
          </p>
          <nav aria-label="メイン">
            <ul className="gnav">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href}>
                    <span className="gnav__en" aria-hidden="true">
                      {n.en}
                    </span>
                    {n.ja}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Header>
        <Main>{children}</Main>
        <Footer>
          <div className="container footer-grid">
            <div>
              <p className="logo footer-logo">サケイベ！</p>
              <p>お酒のイベントを、探す・知る・訪れる。</p>
            </div>
            <nav aria-label="ジャンル">
              <p className="footer-head">ジャンル</p>
              <ul className="footer-nav">
                {Object.entries(GENRES).map(([g, label]) => (
                  <li key={g}>
                    <Link href={`/genres/${g}/`}>{label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="サイト">
              <p className="footer-head">サイト</p>
              <ul className="footer-nav">
                {FOOTER_NAV.map((n) => (
                  <li key={n.href}>
                    <Link href={n.href}>{n.ja}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="container footer-note">
            <p>
              掲載情報は出典をもとにしていますが、変更・中止される場合があります。最新情報は公式サイトでご確認ください。
            </p>
            <p>お酒は20歳になってから。飲酒運転は法律で禁止されています。</p>
            <p>&copy; サケイベ！</p>
          </div>
        </Footer>
      </body>
    </html>
  )
}
export default RootLayout
