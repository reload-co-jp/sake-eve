/**
 * Event name and overview written by Claude from the source text, so the site never republishes it verbatim
 * and shows the event's own name instead of the article headline.
 * Returns null when the model declines. Needs ANTHROPIC_API_KEY.
 */
import Anthropic from "@anthropic-ai/sdk"

const SYSTEM = `お酒のイベント情報サイトの編集者として、プレスリリースや記事の本文からイベント名と概要を書く。
- 1行目はイベント名だけを書く。本文にある正式名称を使い、【】や宣伝文句、日付は付けない。名称がなければ内容が分かる短い名前を付ける。
- 2行目以降に概要を書く。日本語の常体（だ・である調）で2文、120字以内。
- どんなイベントで、何が楽しめるかを書く。日時・会場・料金は別欄に載るので書かない。
- 本文に書かれていないことは推測で補わない。原文の文をそのまま写さず、自分の言葉でまとめる。
- イベント名と概要だけを出力する。前置きや見出しは付けない。`

let client: Anthropic | null = null

export const summarize = async (
  title: string,
  body: string
): Promise<{ name: string; description: string } | null> => {
  if (!body.trim()) return null
  client ??= new Anthropic()
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: `タイトル: ${title}\n\n${body}` }],
  })
  if (res.stop_reason !== "end_turn") return null
  const [name = "", ...rest] = res.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim()
    .split("\n")
  const description = rest.join("").trim()
  return name.trim() && description
    ? { name: name.trim(), description }
    : null
}
