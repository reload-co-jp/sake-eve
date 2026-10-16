import { expect, it } from "vitest"
import { parseArticle } from "./summarize"

it("splits title, lead and paragraphs", () => {
  const expected = {
    title: "タイトル",
    summary: "リード。",
    body: "段落1の続き。\n\n段落2。",
  }
  expect(
    parseArticle("タイトル\nリード。\n\n段落1の\n続き。\n\n\n段落2。\n")
  ).toEqual(expected)
  expect(
    parseArticle("タイトル\n\nリード。\n\n段落1の\n続き。\n\n段落2。")
  ).toEqual(expected)
  expect(parseArticle("タイトルだけ")).toBeNull()
})
