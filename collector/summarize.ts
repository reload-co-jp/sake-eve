/**
 * Event name and overview written by Claude from the source text, so the site never republishes it verbatim
 * and shows the event's own name instead of the article headline.
 * Returns null when the model declines. Needs ANTHROPIC_API_KEY.
 */
import Anthropic from "@anthropic-ai/sdk"
import { execFile as execFileCb } from "node:child_process"
import { promisify } from "node:util"

const execFile = promisify(execFileCb)

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
  return parseSummary(
    res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
  )
}

const parseSummary = (text: string) => {
  const [name = "", ...rest] = text.trim().split("\n")
  const description = rest.join("").trim()
  return name.trim() && description ? { name: name.trim(), description } : null
}

/** summarize() on the local Claude Code CLI, for rewriting overviews without an API key. */
export const summarizeLocal = async (title: string, body: string) =>
  body.trim()
    ? parseSummary(await claudeCli(SYSTEM, `タイトル: ${title}\n\n${body}`))
    : null

const ARTICLE_SYSTEM = `お酒のイベント情報サイトのライターとして、プレスリリースや記事の本文からイベント紹介記事を書く。
- 1行目は記事タイトル。イベント名を入れ、30字程度で読みたくなるものにする。【】や日付は付けない。
- 2行目はリード文。80字以内の1文。
- 3行目は空行、4行目以降が本文。3〜5段落、段落の間は空行1つ。全体で400〜700字。
- 本文では、会の趣旨（誰が何のために開くか）、提供されるお酒（銘柄・蔵元・種類・飲み方など本文にあるもの）、みどころや魅力を順に紹介する。
- 語り口はカジュアルな「です・ます」調。読者に話しかけるように親しみやすく、でも大げさな煽りはしない。
- 日時・会場・料金・申込方法はイベント欄に載るので本文では細かく書かない。
- 本文に書かれていないことは推測で補わない。原文の文をそのまま写さず、自分の言葉で書く。
- 見出し・箇条書き・Markdown記号は使わない。記事以外の前置きは付けない。`

/** title / lead / body (paragraphs split by blank lines) from the model's plain-text output. */
export const parseArticle = (
  text: string
): { title: string; summary: string; body: string } | null => {
  // Paragraph blocks; the title and lead may or may not be separated by a blank line.
  const blocks = text
    .trim()
    .split(/\n\s*\n/)
    .map((b) =>
      b
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
    )
  const [title = "", summary = "", ...lead] = blocks.shift() ?? []
  if (!summary && blocks[0]?.length === 1) {
    return parseArticle(
      `${title}\n${blocks[0][0]}\n\n${blocks
        .slice(1)
        .map((b) => b.join("\n"))
        .join("\n\n")}`
    )
  }
  const body = [lead, ...blocks]
    .map((b) => b.join(""))
    .filter(Boolean)
    .join("\n\n")
  return title && summary && body ? { title, summary, body } : null
}

/**
 * Event introduction article written from the source text by the local Claude Code CLI (`claude -p`),
 * so it runs on the logged-in subscription without an API key. Returns null on empty output.
 */
export const writeArticle = async (eventName: string, body: string) => {
  if (!body.trim()) return null
  const stdout = await claudeCli(
    ARTICLE_SYSTEM,
    `イベント名: ${eventName}\n\n${body}`
  )
  const article = parseArticle(stdout)
  if (!article) console.error(stdout)
  return article
}

const claudeCli = async (system: string, input: string) => {
  const run = execFile(
    "claude",
    [
      "-p",
      "--model",
      "opus",
      "--system-prompt",
      system,
      "--tools",
      "",
      "--no-session-persistence",
    ],
    { maxBuffer: 10 * 1024 * 1024, timeout: 300_000 }
  )
  run.child.stdin?.end(input)
  return (await run).stdout
}
