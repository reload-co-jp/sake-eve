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
  <header
    style={{
      backgroundColor: "#333",
      boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
      padding: ".5rem 1rem",
      position: "relative",
    }}
  >
    {children}
  </header>
)

export const Main: FC<{ children: ReactNode }> = ({ children }) => (
  <main
    style={{
      background: "#222",
      minHeight: "calc(100dvh - 5.625rem)",
      padding: "1rem",
    }}
  >
    {children}
  </main>
)

export const Footer: FC<{ children: ReactNode }> = ({ children }) => (
  <footer
    style={{
      backgroundColor: "#333",
      boxShadow: "0 -4px 6px rgba(0, 0, 0, 0.1)",
      fontSize: ".75rem",
      padding: "1rem",
    }}
  >
    {children}
  </footer>
)
