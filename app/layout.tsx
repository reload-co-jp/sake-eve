import { Footer, Header, Main, Title } from "@/components/elements/layout"
import "./reset.css"

export const metadata = {
  title: "Page title",
  description: "Page description",
}

const RootLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="ja">
      <body>
        <Header>
          <Title>Page title</Title>
        </Header>
        <Main>{children}</Main>
        <Footer>
          <p>&copy; My organization</p>
        </Footer>
      </body>
    </html>
  )
}
export default RootLayout
