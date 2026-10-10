import { ComponentProps, FC, ReactNode } from "react"

export const Title: FC<ComponentProps<"h1">> = ({
  style,
  children,
  ...props
}) => (
  <h1 style={{ fontSize: "1rem", margin: 0, ...style }} {...props}>
    {children}
  </h1>
)

export const Header: FC<{ children: ReactNode }> = ({ children }) => (
  <header className="site-header">{children}</header>
)

export const Main: FC<{ children: ReactNode }> = ({ children }) => (
  <main id="main" className="site-main">
    {children}
  </main>
)

export const Footer: FC<{ children: ReactNode }> = ({ children }) => (
  <footer className="site-footer">{children}</footer>
)

/** Two-line heading: decorative English label over the Japanese title. */
export const SectionTitle: FC<{
  en: string
  ja: string
  id?: string
  as?: "h1" | "h2"
}> = ({ en, ja, id, as: Tag = "h2" }) => (
  <Tag id={id} className="section-title">
    <span className="section-title__en" aria-hidden="true">
      {en}
    </span>
    <span className="section-title__ja">{ja}</span>
  </Tag>
)
