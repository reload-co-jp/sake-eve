/** Polite HTTP client: honours robots.txt, spaces requests, never retries around blocks. */

export type FetchText = (url: string) => Promise<string>

type Rule = { allow: boolean; pattern: string }

/** Rules of the `User-agent: *` group(s). */
export const parseRobots = (txt: string): Rule[] => {
  const rules: Rule[] = []
  let inStar = false
  let lastWasAgent = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const [, key, value] = m
    if (key.toLowerCase() === "user-agent") {
      // Consecutive user-agent lines share one group.
      inStar = (lastWasAgent && inStar) || value === "*"
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    const k = key.toLowerCase()
    if (inStar && (k === "allow" || k === "disallow") && value)
      rules.push({ allow: k === "allow", pattern: value })
  }
  return rules
}

const toRegExp = (pattern: string) => {
  const anchored = pattern.endsWith("$")
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
  return new RegExp(`^${body}${anchored ? "$" : ""}`)
}

/** Longest matching rule wins; Allow wins ties (RFC 9309). */
export const isAllowed = (rules: Rule[], pathAndQuery: string) => {
  let best: Rule | null = null
  for (const r of rules) {
    if (!toRegExp(r.pattern).test(pathAndQuery)) continue
    if (
      !best ||
      r.pattern.length > best.pattern.length ||
      (r.pattern.length === best.pattern.length && r.allow)
    )
      best = r
  }
  return best ? best.allow : true
}

export class BlockedError extends Error {}

/** Decode by HTTP charset, else <meta charset>/XML declaration, else UTF-8 (Japanese sites still use Shift_JIS/EUC-JP). */
export const decodeBody = (bytes: Uint8Array, contentType: string | null) => {
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 2048))
  const label =
    contentType?.match(/charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<\?xml[^>]+encoding=["']([\w-]+)/i)?.[1] ??
    "utf-8"
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}

export const createFetcher = (opts: {
  userAgent: string
  intervalMs: number
  timeoutMs: number
  fetchImpl?: typeof fetch
}): FetchText => {
  const doFetch = opts.fetchImpl ?? fetch
  const robots = new Map<string, Promise<Rule[]>>()
  let last = 0

  const get = async (url: string) => {
    const wait = last + opts.intervalMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    return doFetch(url, {
      headers: { "User-Agent": opts.userAgent },
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  }

  return async (url) => {
    const u = new URL(url)
    if (!robots.has(u.origin)) {
      robots.set(
        u.origin,
        get(`${u.origin}/robots.txt`).then(async (r) =>
          // Missing robots.txt (4xx) means no restrictions; 5xx means assume full disallow.
          r.ok
            ? parseRobots(await r.text())
            : r.status >= 500
              ? [{ allow: false, pattern: "/" }]
              : []
        )
      )
    }
    if (!isAllowed(await robots.get(u.origin)!, u.pathname + u.search))
      throw new BlockedError(
        `robots.txtで禁止されているため取得しません: ${url}`
      )
    const res = await get(url)
    if (res.status === 403 || res.status === 429)
      throw new BlockedError(
        `アクセス制限 (HTTP ${res.status}) のため中止: ${url}`
      )
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
    return decodeBody(
      new Uint8Array(await res.arrayBuffer()),
      res.headers.get("content-type")
    )
  }
}
