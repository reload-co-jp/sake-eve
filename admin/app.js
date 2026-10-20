/* global window, document, location, fetch, structuredClone, confirm, sessionStorage */
// Admin UI. Plain DOM: every value from data (incl. collected titles) goes through textContent.
const TOKEN = document.querySelector('meta[name="admin-token"]').content
const app = document.getElementById("app")
const tabs = document.getElementById("tabs")
let state = null
let notice = null
/** Events filled from their source pages, waiting to be shown in the editor. */
const fetchedDrafts = new Map()
/** Result of the last source fetch (shown in the editor). */
let fetchNote = null

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v)
    else if (k === "value") el.value = v
    else if (k === "checked") el.checked = v
    else el.setAttribute(k, v === true ? "" : v)
  }
  for (const c of children.flat())
    if (c !== null && c !== undefined && c !== false) el.append(c)
  return el
}

const api = async (method, path, body) => {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Admin-Token": TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error((json.errors || ["エラー"]).join("\n"))
  return json
}

const load = async () => {
  state = await api("GET", "state")
}

// ---- date helpers (JST) ----
const pad = (n) => String(n).padStart(2, "0")
const toJst = (iso) => new Date(Date.parse(iso) + 9 * 3600e3)
const isoToLocal = (iso) => {
  if (!iso) return ""
  const d = toJst(iso)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
const localToIso = (v) => (v ? `${v}:00+09:00` : null)
const fmt = (iso) => (iso ? isoToLocal(iso).replace("T", " ") : "—")
const nowIso = () => localToIso(isoToLocal(new Date().toISOString()))

// 開始日時を入力したとき、終了日時が未入力なら自動補う既定オフセット（時間）
const DEFAULT_END_OFFSET_HOURS = 2
const addHours = (local, hours) => {
  if (!local) return ""
  const d = new Date(`${local}:00`)
  d.setMinutes(d.getMinutes() + hours * 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const period = (e) => {
  if (!e.startAt) return "日程未定"
  const s = fmt(e.startAt)
  const t = e.endAt ? fmt(e.endAt) : ""
  return e.dateOnly ? `${s.slice(0, 10)}〜${t.slice(0, 10)}` : `${s}〜${t}`
}
const label = (group, key) => state.enums[group][key] ?? key
const byId = (col, id) => state.db[col].find((x) => x.id === id)

// ---- routing ----
const VIEWS = {
  queue: "承認待ち",
  events: "イベント",
  articles: "記事",
  producers: "事業者",
  products: "商品",
  sources: "出典",
  duplicates: "重複候補",
  log: "収集ログ",
  audit: "変更履歴",
}
const route = () => {
  const [view, id = ""] = location.hash
    .slice(1)
    .split("/")
    .map(decodeURIComponent)
  return { view: view in VIEWS ? view : "queue", id }
}
const go = (view, id) =>
  (location.hash = id ? `${view}/${encodeURIComponent(id)}` : view)

const render = () => {
  const { view, id } = route()
  tabs.replaceChildren(
    ...Object.entries(VIEWS).map(([k, v]) =>
      h(
        "button",
        {
          type: "button",
          "aria-current": k === view ? "page" : null,
          onclick: () => go(k),
        },
        k === "queue"
          ? `${v} (${state.db.events.filter((e) => e.publication === "pending").length})`
          : v
      )
    )
  )
  const body =
    view === "queue"
      ? queueView()
      : view === "events"
        ? id
          ? eventEditor(id)
          : eventList()
        : ["articles", "producers", "products"].includes(view)
          ? id
            ? jsonEditor(view, id)
            : recordList(view)
          : view === "sources"
            ? sourcesView()
            : view === "duplicates"
              ? duplicatesView()
              : view === "log"
                ? logView()
                : auditView()
  app.replaceChildren(
    notice
      ? h(
          "div",
          { class: `notice ${notice.ok ? "ok" : "ng"}`, role: "status" },
          notice.text
        )
      : "",
    body
  )
}

const flash = (ok, text) => {
  notice = { ok, text }
  render()
  app.focus()
}

const act = async (fn, okText) => {
  try {
    await fn()
    await load()
    flash(true, okText)
  } catch (e) {
    flash(false, e.message)
  }
}

// ---- approval ----
/**
 * Read the event's source pages and fill its empty fields.
 * Nothing is saved here: the editor checks the result and saves it.
 */
const fetchSource = async (e, { sourceId, draft } = {}) => {
  const r = await api(
    "POST",
    `events/${encodeURIComponent(e.id)}/fetch-source`,
    {
      sourceId,
      draft,
    }
  )
  fetchedDrafts.set(e.id, r.event)
  fetchNote = {
    id: e.id,
    text: r.filled.length
      ? `ソースから取得しました: ${r.filled.join("、")}`
      : "出典に新しい情報はありませんでした",
    notes: r.notes ?? [],
  }
  return r
}

const dupesOf = (e) =>
  state.duplicates.filter(
    (d) => d.eventId === e.id || d.candidateEventId === e.id
  )

/** Fold `drop` into `keep` (server keeps keep's values, unites sources/links, deletes drop). */
const mergeButton = (keepId, dropId) =>
  h(
    "button",
    {
      type: "button",
      onclick: () => {
        const keep = byId("events", keepId)
        const drop = byId("events", dropId)
        if (
          !confirm(
            `「${drop.title}」を「${keep.title}」に統合し、削除します。よろしいですか？`
          )
        )
          return
        act(
          () =>
            api("POST", `events/${encodeURIComponent(keepId)}/merge`, {
              dropId,
            }),
          `統合しました: ${keep.title}`
        ).then(() => go("events", keepId))
      },
    },
    `「${byId("events", keepId)?.title ?? keepId}」に統合`
  )

const publicationButtons = (e) => {
  const note = h("input", {
    type: "text",
    placeholder: "メモ（任意。承認・非公開の理由など）",
    "aria-label": "承認メモ",
  })
  const set = (p, text) =>
    act(
      () =>
        api("POST", `events/${encodeURIComponent(e.id)}/publication`, {
          publication: p,
          note: note.value,
        }),
      text
    )
  const blocked = e.verificationStatus === "needs_review"
  return h(
    "div",
    { class: "actions" },
    note,
    h(
      "button",
      {
        type: "button",
        class: "primary",
        disabled: blocked || e.publication === "published",
        title: blocked
          ? "確認状態を「要確認」以外にしてから公開してください"
          : null,
        onclick: () =>
          (!dupesOf(e).length ||
            confirm(
              "重複候補があります。重複でないことを確認して公開しますか？"
            )) &&
          set("published", `公開しました: ${e.title}`),
      },
      "公開する"
    ),
    h(
      "button",
      {
        type: "button",
        class: "danger",
        disabled: e.publication === "hidden",
        onclick: () => set("hidden", `非公開にしました: ${e.title}`),
      },
      "非公開にする"
    ),
    h(
      "button",
      {
        type: "button",
        disabled: e.publication === "pending",
        onclick: () => set("pending", `承認待ちに戻しました: ${e.title}`),
      },
      "承認待ちに戻す"
    ),
    blocked
      ? h(
          "span",
          { class: "meta" },
          "※要確認のため公開不可。編集で確認状態を更新してください。"
        )
      : ""
  )
}

const eventCard = (e) => {
  const sources = e.sourceIds.map((id) => byId("sources", id)).filter(Boolean)
  const dupes = dupesOf(e)
  return h(
    "article",
    { class: "card" },
    h(
      "p",
      { class: "meta" },
      h(
        "span",
        { class: "badge" },
        label("publicationStatuses", e.publication)
      ),
      h(
        "span",
        { class: "badge" },
        label("verificationStatuses", e.verificationStatus)
      ),
      e.isSample ? h("span", { class: "badge" }, "サンプル") : "",
      ` ${period(e)} ／ ${e.venue.prefecture ?? "都道府県不明"} ${e.venue.name ?? ""}`
    ),
    h("h3", {}, e.title),
    h(
      "p",
      { class: "meta" },
      `ジャンル: ${e.genres.map((g) => label("genres", g)).join("・")} ／ 形式: ${e.eventTypes.map((t) => label("eventTypes", t)).join("・")}`
    ),
    h(
      "ul",
      {},
      sources.map((s) =>
        h(
          "li",
          {},
          h(
            "a",
            { href: s.url, target: "_blank", rel: "noopener noreferrer" },
            s.title
          ),
          h(
            "span",
            { class: "meta" },
            ` ${label("sourceTypes", s.sourceType)} ／ 取得 ${fmt(s.fetchedAt)}`
          )
        )
      )
    ),
    dupes.length
      ? h(
          "p",
          { class: "meta" },
          "重複候補: ",
          dupes.map((d) => {
            const other = d.eventId === e.id ? d.candidateEventId : d.eventId
            return h(
              "a",
              { href: `#events/${encodeURIComponent(other)}` },
              `${byId("events", other)?.title ?? other}（${label("publicationStatuses", byId("events", other)?.publication)}・類似度 ${d.score}） `
            )
          })
        )
      : "",
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { type: "button", onclick: () => go("events", e.id) },
        "編集・確認"
      ),
      h(
        "button",
        {
          type: "button",
          onclick: async (ev) => {
            const btn = ev.currentTarget
            btn.disabled = true
            btn.textContent = "取得中…"
            try {
              await fetchSource(e)
              await load()
              go("events", e.id)
            } catch (err) {
              btn.disabled = false
              btn.textContent = "ソースから取得"
              flash(false, err.message)
            }
          },
        },
        "ソースから取得"
      )
    ),
    publicationButtons(e)
  )
}

/**
 * Google News is used by the editor in their own browser (its RSS may not be fetched by bots);
 * the original article URL is then imported here, which fetches only that page.
 */
const discoverPanel = () => {
  const url = h("input", {
    type: "url",
    placeholder: "元記事のURL（https://…）",
    "aria-label": "取り込むURL",
    style: "min-width:24rem;flex:1",
  })
  const msg = h("span", { class: "meta", role: "status" })
  const run = async (ev) => {
    ev.preventDefault()
    msg.textContent = "取得中…"
    try {
      const r = await api("POST", "import", { url: url.value.trim() })
      await load()
      go("events", r.eventId)
      flash(true, "取り込みました（承認待ち）。内容を確認してください。")
    } catch (e) {
      msg.textContent = e.message
    }
  }
  const gnews = (q) =>
    `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`
  return h(
    "section",
    { class: "card" },
    h("h3", {}, "ニュースから探す"),
    h(
      "p",
      { class: "meta" },
      "Google ニュースはブラウザで開いて探します（自動取得は利用条件で禁止）。良い記事があれば、記事を開いて元サイトのURLを下に貼ると、そのページだけを取得して承認待ちに登録します。"
    ),
    h(
      "p",
      {},
      state.newsQueries.map((q) =>
        h(
          "a",
          {
            href: gnews(q),
            target: "_blank",
            rel: "noopener noreferrer",
            style: "margin-right:1rem",
          },
          q
        )
      )
    ),
    h(
      "form",
      { class: "actions", onsubmit: run },
      url,
      h("button", { type: "submit", class: "primary" }, "URLから取り込む"),
      msg
    )
  )
}

const queueView = () => {
  const pending = state.db.events.filter((e) => e.publication === "pending")
  return h(
    "section",
    {},
    discoverPanel(),
    h("h2", {}, `承認待ち ${pending.length}件`),
    h(
      "p",
      { class: "meta" },
      "原典で日時・会場を確認 → 編集で確認状態と最終確認日時を更新 → 公開。公開はリポジトリへの反映（PRのマージ）後にサイトへ出ます。"
    ),
    pending.length
      ? pending.map(eventCard)
      : h("p", {}, "承認待ちのイベントはありません。")
  )
}

// ---- lists ----
const searchBox = (onInput, placeholder, value = "") =>
  h("input", {
    type: "search",
    placeholder,
    "aria-label": placeholder,
    value,
    oninput: (ev) => onInput(ev.target.value),
  })

const eventList = () => {
  const tbody = h("tbody")
  // ページ遷移・リロードでも検索ワードと公開状態フィルタを保持する
  const savedFilter = sessionStorage.getItem("admin:events:filter")
  const saved = savedFilter ? JSON.parse(savedFilter) : {}
  let q = saved.q ?? ""
  let pub = saved.pub ?? ""
  const saveFilter = () =>
    sessionStorage.setItem(
      "admin:events:filter",
      JSON.stringify({ q, pub })
    )
  const fill = () =>
    tbody.replaceChildren(
      ...state.db.events
        .filter(
          (e) =>
            (!pub || e.publication === pub) &&
            (!q || e.title.includes(q) || e.id.includes(q))
        )
        .map((e) =>
          h(
            "tr",
            {},
            h(
              "td",
              {},
              h("a", { href: `#events/${encodeURIComponent(e.id)}` }, e.title)
            ),
            h("td", {}, period(e)),
            h("td", {}, e.venue.prefecture ?? "—"),
            h("td", {}, label("publicationStatuses", e.publication)),
            h("td", {}, label("verificationStatuses", e.verificationStatus)),
            h("td", {}, e.isSample ? "サンプル" : "")
          )
        )
    )
  fill()
  return h(
    "section",
    {},
    h("h2", {}, "イベント"),
    h(
      "div",
      { class: "toolbar" },
      searchBox(
        (v) => {
          q = v
          saveFilter()
          fill()
        },
        "タイトル・IDで絞り込み",
        q
      ),
      h(
        "select",
        {
          "aria-label": "公開状態",
          value: pub,
          onchange: (ev) => {
            pub = ev.target.value
            saveFilter()
            fill()
          },
        },
        h("option", { value: "" }, "すべての公開状態"),
        Object.entries(state.enums.publicationStatuses).map(([k, v]) =>
          h("option", { value: k, selected: k === pub }, v)
        )
      ),
      h(
        "button",
        {
          type: "button",
          class: "primary",
          onclick: () => go("events", "__new__"),
        },
        "新規イベント"
      )
    ),
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ["タイトル", "日程", "都道府県", "公開", "確認", ""].map((t) =>
            h("th", {}, t)
          )
        )
      ),
      tbody
    )
  )
}

const recordList = (col) => {
  const name = (r) => r.title ?? r.name
  return h(
    "section",
    {},
    h("h2", {}, VIEWS[col]),
    h(
      "div",
      { class: "toolbar" },
      h(
        "button",
        { type: "button", class: "primary", onclick: () => go(col, "__new__") },
        "新規作成"
      )
    ),
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h("tr", {}, h("th", {}, "名称"), h("th", {}, "ID"), h("th", {}, ""))
      ),
      h(
        "tbody",
        {},
        state.db[col].map((r) =>
          h(
            "tr",
            {},
            h(
              "td",
              {},
              h("a", { href: `#${col}/${encodeURIComponent(r.id)}` }, name(r))
            ),
            h("td", {}, r.id),
            h("td", {}, r.isSample ? "サンプル" : "")
          )
        )
      )
    )
  )
}

// ---- event editor ----
const NEW_EVENT = () => ({
  id: `evt-${Date.now().toString(36)}`,
  slug: "",
  title: "",
  description: null,
  genres: ["other"],
  eventTypes: ["other"],
  startAt: null,
  endAt: null,
  venue: {
    name: null,
    address: null,
    prefecture: null,
    city: null,
    latitude: null,
    longitude: null,
  },
  organizer: null,
  officialUrl: null,
  ticketUrl: null,
  imageUrl: null,
  price: null,
  isFree: null,
  reservationRequired: null,
  sourceIds: [],
  producerIds: [],
  productIds: [],
  articleIds: [],
  status: "unknown",
  verificationStatus: "unverified",
  lastVerifiedAt: null,
  createdAt: nowIso(),
  updatedAt: nowIso(),
  dateOnly: false,
  isSample: false,
  publication: "pending",
})

const eventEditor = (id, draft = null) => {
  const isNew = id === "__new__"
  // Values fetched from the source pages take precedence over the stored record.
  const stored = isNew
    ? null
    : (fetchedDrafts.get(id) ?? byId("events", id) ?? null)
  if (stored) fetchedDrafts.delete(id)
  const e = draft ?? (isNew ? NEW_EVENT() : structuredClone(stored))
  if (!e) return h("p", {}, `イベントが見つかりません: ${id}`)
  const f = {}
  const text = (key, labelText, value, attrs = {}) => {
    f[key] = h(attrs.multiline ? "textarea" : "input", {
      type: attrs.type ?? "text",
      value: value ?? "",
      ...attrs,
      multiline: null,
    })
    return h("label", { class: attrs.wide ? "wide" : null }, labelText, f[key])
  }
  const select = (key, labelText, options, value) => {
    f[key] = h(
      "select",
      {},
      Object.entries(options).map(([k, v]) =>
        h("option", { value: k, selected: k === String(value) }, v)
      )
    )
    return h("label", {}, labelText, f[key])
  }
  const checks = (key, legend, options, values) => {
    f[key] = Object.keys(options).map((k) =>
      h("input", { type: "checkbox", value: k, checked: values.includes(k) })
    )
    return h(
      "fieldset",
      { class: "wide" },
      h("legend", {}, legend),
      Object.entries(options).map(([, v], i) => h("label", {}, f[key][i], v))
    )
  }
  const multi = (key, legend, col, values) => {
    f[key] = h(
      "select",
      { multiple: true, size: 4 },
      state.db[col].map((r) =>
        h(
          "option",
          { value: r.id, selected: values.includes(r.id) },
          r.title ?? r.name
        )
      )
    )
    return h("label", {}, legend, f[key])
  }
  const triBool = { "": "不明", true: "はい", false: "いいえ" }
  const dateInput = (iso) =>
    e.dateOnly ? isoToLocal(iso).slice(0, 10) : isoToLocal(iso)

  const form = h(
    "form",
    { class: "edit", onsubmit: (ev) => (ev.preventDefault(), save()) },
    text("title", "イベント名", e.title, { wide: true, required: true }),
    text("slug", "slug（URL。半角英小文字・数字・ハイフン）", e.slug, {
      required: true,
      pattern: "[a-z0-9]+(-[a-z0-9]+)*",
    }),
    h(
      "label",
      {},
      "ID（変更不可）",
      h("input", { value: e.id, readonly: true })
    ),
    text("description", "概要（独自の文章。原文の転載は不可）", e.description, {
      multiline: true,
      wide: true,
    }),
    checks("genres", "酒類ジャンル", state.enums.genres, e.genres),
    checks("eventTypes", "イベント形式", state.enums.eventTypes, e.eventTypes),
    (() => {
      f.dateOnly = h("input", {
        type: "checkbox",
        checked: e.dateOnly,
        onchange: () => {
          e.dateOnly = f.dateOnly.checked
          collect()
          rerenderForm()
        },
      })
      return h(
        "fieldset",
        { class: "wide" },
        h("legend", {}, "日時"),
        h("label", {}, f.dateOnly, "日付のみ判明（時刻不明）")
      )
    })(),
    text("startAt", "開始（JST）", dateInput(e.startAt), {
      type: e.dateOnly ? "date" : "datetime-local",
      onchange: () => {
        // 終了が未入力のときだけ、開始に連動して終了を自動入力する
        if (!f.endAt.value) {
          f.endAt.value = e.dateOnly
            ? f.startAt.value
            : addHours(f.startAt.value, DEFAULT_END_OFFSET_HOURS)
        }
      },
    }),
    text("endAt", "終了（JST）", dateInput(e.endAt), {
      type: e.dateOnly ? "date" : "datetime-local",
    }),
    text("venueName", "会場名", e.venue.name),
    text("address", "住所（入力で緯度経度が空なら自動取得）", e.venue.address, {
      onchange: async () => {
        const q = f.address.value.replace(/〒?\s*\d{3}[-－−‐]\d{4}/, "").trim()
        if (!q || f.latitude.value || f.longitude.value) return
        try {
          const res = await fetch(
            `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`
          )
          const [lng, lat] = (await res.json())[0]?.geometry?.coordinates ?? []
          if (lat === undefined || f.latitude.value || f.longitude.value) return
          f.latitude.value = lat
          f.longitude.value = lng
        } catch {
          // Offline or no hit: coordinates stay manual.
        }
      },
    }),
    select(
      "prefecture",
      "都道府県",
      {
        "": "不明",
        ...Object.fromEntries(state.enums.prefectures.map((p) => [p, p])),
      },
      e.venue.prefecture ?? ""
    ),
    text("city", "市区町村", e.venue.city),
    text("latitude", "緯度（-90〜90）", e.venue.latitude, {
      type: "number",
      step: "any",
    }),
    text("longitude", "経度（-180〜180）", e.venue.longitude, {
      type: "number",
      step: "any",
    }),
    text("organizer", "主催者", e.organizer),
    text("officialUrl", "公式サイトURL", e.officialUrl, { type: "url" }),
    text("ticketUrl", "チケットURL", e.ticketUrl, { type: "url" }),
    text("imageUrl", "画像URL", e.imageUrl, { type: "url" }),
    text("price", "入場料（表示用）", e.price),
    select("isFree", "入場無料", triBool, e.isFree ?? ""),
    select(
      "reservationRequired",
      "要予約",
      triBool,
      e.reservationRequired ?? ""
    ),
    select(
      "status",
      "開催状況（中止・延期は出典確認のうえ）",
      state.enums.eventStatuses,
      e.status
    ),
    select(
      "verificationStatus",
      "確認状態",
      state.enums.verificationStatuses,
      e.verificationStatus
    ),
    (() => {
      f.lastVerifiedAt = h("input", {
        type: "datetime-local",
        value: isoToLocal(e.lastVerifiedAt),
      })
      return h(
        "label",
        {},
        "最終確認日時（JST）",
        f.lastVerifiedAt,
        h(
          "button",
          {
            type: "button",
            onclick: () =>
              (f.lastVerifiedAt.value = isoToLocal(new Date().toISOString())),
          },
          "今確認した"
        )
      )
    })(),
    multi(
      "producerIds",
      "出店者（Ctrl/⌘で複数選択）",
      "producers",
      e.producerIds
    ),
    multi("productIds", "商品", "products", e.productIds),
    multi("articleIds", "関連記事", "articles", e.articleIds),
    multi("sourceIds", "出典（1件以上）", "sources", e.sourceIds),
    newSourceForm((sid) => {
      collect()
      e.sourceIds = [...new Set([...e.sourceIds, sid])]
      rerenderForm()
    }),
    h(
      "div",
      { class: "actions wide" },
      h(
        "button",
        { type: "submit", class: "primary" },
        isNew ? "作成（承認待ちとして保存）" : "保存"
      ),
      h(
        "button",
        { type: "button", onclick: () => go("events") },
        "一覧へ戻る"
      ),
      h(
        "span",
        { class: "meta" },
        `公開状態: ${label("publicationStatuses", e.publication)}（公開・非公開は下のボタンで切替）`
      )
    )
  )

  const num = (v) => (v === "" ? null : Number(v))
  const str = (v) => (v.trim() === "" ? null : v.trim())
  const bool = (v) => (v === "" ? null : v === "true")
  const dateVal = (v, end) =>
    !v
      ? null
      : e.dateOnly
        ? `${v.slice(0, 10)}T${end ? "23:59" : "00:00"}:00+09:00`
        : localToIso(v)
  const selected = (el) => [...el.selectedOptions].map((o) => o.value)
  const checked = (els) => els.filter((x) => x.checked).map((x) => x.value)

  const collect = () => {
    Object.assign(e, {
      title: f.title.value.trim(),
      slug: f.slug.value.trim(),
      description: str(f.description.value),
      genres: checked(f.genres),
      eventTypes: checked(f.eventTypes),
      dateOnly: f.dateOnly.checked,
      startAt: dateVal(f.startAt.value, false),
      endAt: dateVal(f.endAt.value, true),
      venue: {
        name: str(f.venueName.value),
        address: str(f.address.value),
        prefecture: f.prefecture.value || null,
        city: str(f.city.value),
        latitude: num(f.latitude.value),
        longitude: num(f.longitude.value),
      },
      organizer: str(f.organizer.value),
      officialUrl: str(f.officialUrl.value),
      ticketUrl: str(f.ticketUrl.value),
      imageUrl: str(f.imageUrl.value),
      price: str(f.price.value),
      isFree: bool(f.isFree.value),
      reservationRequired: bool(f.reservationRequired.value),
      status: f.status.value,
      verificationStatus: f.verificationStatus.value,
      lastVerifiedAt: f.lastVerifiedAt.value
        ? localToIso(f.lastVerifiedAt.value)
        : null,
      producerIds: selected(f.producerIds),
      productIds: selected(f.productIds),
      articleIds: selected(f.articleIds),
      sourceIds: selected(f.sourceIds),
    })
    return e
  }
  const save = () =>
    act(async () => {
      await api(
        isNew ? "POST" : "PUT",
        `events/${encodeURIComponent(e.id)}`,
        collect()
      )
      if (isNew) go("events", e.id)
    }, `保存しました: ${e.title}`)

  const wrap = h("section", {})
  // Switching date-only changes input types; rebuild with the unsaved values.
  const rerenderForm = () => wrap.replaceWith(eventEditor(id, e))

  /** Read the source pages and fill the empty fields of the form. */
  const fetchPanel = () => {
    const status = h("span", { class: "meta", role: "status" })
    const sources = e.sourceIds.map((id) => byId("sources", id)).filter(Boolean)
    const run = async (sourceId) => {
      status.textContent = "取得中…"
      try {
        const r = await fetchSource(e, { sourceId, draft: collect() })
        // Rebuild the form with the filled values; the editor still saves them.
        wrap.replaceWith(eventEditor(id, r.event))
      } catch (err) {
        status.textContent = err.message
      }
    }
    return h(
      "section",
      {},
      h("h2", {}, "ソースから取得して埋める"),
      h(
        "p",
        { class: "meta" },
        "未入力の項目（日程・会場・住所・都道府県・市区町村・ジャンル・形式・公式サイト・画像）を、出典のページから取得して埋めます。入力済みの値は上書きしません。取得後は内容を確認してから保存してください。"
      ),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { type: "button", class: "primary", onclick: () => run(null) },
          "すべての出典から取得"
        ),
        sources.map((s) =>
          h(
            "button",
            { type: "button", onclick: () => run(s.id) },
            `「${s.title.slice(0, 24)}」から取得`
          )
        ),
        status
      )
    )
  }

  wrap.append(
    h("h2", {}, isNew ? "新規イベント" : "イベント編集"),
    !isNew && e.isSample
      ? h("p", { class: "meta" }, "サンプルデータです。")
      : "",
    fetchNote && fetchNote.id === id
      ? h(
          "p",
          { class: "meta", role: "status" },
          fetchNote.text,
          fetchNote.notes.length ? `（${fetchNote.notes.join(" / ")}）` : ""
        )
      : "",
    form,
    isNew
      ? ""
      : h("section", {}, h("h2", {}, "公開承認"), publicationButtons(e)),
    isNew ? "" : sourceDetails(e),
    isNew ? "" : fetchPanel()
  )
  return wrap
}

/** Manual / official source entry. fetchedAt = when the editor checked it. */
const newSourceForm = (onCreated) => {
  const url = h("input", {
    type: "url",
    placeholder: "https://…（公式サイト・主催者発表など）",
    "aria-label": "出典URL",
  })
  const title = h("input", {
    type: "text",
    placeholder: "出典タイトル",
    "aria-label": "出典タイトル",
  })
  const publisher = h("input", {
    type: "text",
    placeholder: "配信元・発表元",
    "aria-label": "配信元",
  })
  const type = h(
    "select",
    { "aria-label": "出典種別" },
    h("option", { value: "official" }, "公式発表"),
    h("option", { value: "manual" }, "手動登録")
  )
  const msg = h("span", { class: "meta", role: "status" })
  // Not via act(): a full re-render would discard the unsaved event form.
  const add = async () => {
    try {
      const id = `src-${Date.now().toString(36)}`
      await api("POST", `sources/${id}`, {
        id,
        sourceType: type.value,
        url: url.value.trim(),
        title: title.value.trim(),
        publisher: publisher.value.trim() || null,
        publishedAt: null,
        fetchedAt: new Date().toISOString(),
        contentHash: null,
        relatedEventIds: [],
        processingStatus: "processed",
        extractedFields: null,
      })
      await load()
      onCreated(id)
    } catch (e) {
      msg.textContent = e.message
    }
  }
  return h(
    "fieldset",
    { class: "wide" },
    h("legend", {}, "出典を追加"),
    type,
    url,
    title,
    publisher,
    h("button", { type: "button", onclick: add }, "追加"),
    msg
  )
}

const sourceDetails = (e) => {
  const sources = e.sourceIds.map((id) => byId("sources", id)).filter(Boolean)
  return h(
    "section",
    {},
    h("h2", {}, "出典と抽出結果"),
    sources.map((s) =>
      h(
        "div",
        { class: "card" },
        h(
          "h3",
          {},
          h(
            "a",
            { href: s.url, target: "_blank", rel: "noopener noreferrer" },
            s.title
          )
        ),
        h(
          "p",
          { class: "meta" },
          `${label("sourceTypes", s.sourceType)} ／ ${s.publisher ?? "配信元不明"} ／ 公開 ${fmt(s.publishedAt)} ／ 取得 ${fmt(s.fetchedAt)} ／ ${s.processingStatus}`
        ),
        s.extractedFields
          ? h("pre", {}, JSON.stringify(s.extractedFields, null, 2))
          : ""
      )
    )
  )
}

// ---- generic JSON editor for articles / producers / products ----
const TEMPLATES = {
  articles: () => ({
    id: `art-${Date.now().toString(36)}`,
    slug: "",
    title: "",
    summary: "",
    body: "",
    thumbnail: null,
    articleType: "event_guide",
    eventIds: [],
    producerIds: [],
    productIds: [],
    sourceIds: [],
    publishedAt: nowIso(),
    updatedAt: nowIso(),
    isSample: false,
  }),
  producers: () => ({
    id: `prd-${Date.now().toString(36)}`,
    slug: "",
    name: "",
    aliases: [],
    producerType: "other",
    address: null,
    prefecture: null,
    officialUrl: null,
    genres: ["other"],
    productIds: [],
    eventIds: [],
    articleIds: [],
    isSample: false,
  }),
  products: () => ({
    id: `pdt-${Date.now().toString(36)}`,
    slug: "",
    name: "",
    producerId: null,
    genres: ["other"],
    description: null,
    releaseDate: null,
    officialUrl: null,
    eventIds: [],
    articleIds: [],
    sourceIds: [],
    isSample: false,
  }),
}

const jsonEditor = (col, id) => {
  const isNew = id === "__new__"
  const record = isNew ? TEMPLATES[col]() : byId(col, id)
  if (!record) return h("p", {}, `見つかりません: ${id}`)
  const area = h("textarea", {
    class: "json",
    "aria-label": "JSON",
    spellcheck: "false",
    value: JSON.stringify(record, null, 2),
  })
  const save = () =>
    act(async () => {
      let parsed
      try {
        parsed = JSON.parse(area.value)
      } catch (e) {
        throw new Error(`JSONの形式が不正です: ${e.message}`, { cause: e })
      }
      if (col === "articles" && !isNew) parsed.updatedAt = nowIso()
      await api(
        isNew ? "POST" : "PUT",
        `${col}/${encodeURIComponent(parsed.id)}`,
        parsed
      )
      if (isNew) go(col, parsed.id)
    }, "保存しました")
  return h(
    "section",
    {},
    h(
      "h2",
      {},
      `${VIEWS[col]}${isNew ? "（新規）" : `: ${record.title ?? record.name}`}`
    ),
    h(
      "p",
      { class: "meta" },
      "保存時に全データを検証します（必須項目・型・参照IDの存在・重複など）。IDは変更できません。不明な値は null。"
    ),
    area,
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        { type: "button", class: "primary", onclick: save },
        isNew ? "作成" : "保存"
      ),
      h("button", { type: "button", onclick: () => go(col) }, "一覧へ戻る")
    )
  )
}

// ---- read-only views ----
const table = (headers, rows) =>
  h(
    "table",
    {},
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        headers.map((t) => h("th", {}, t))
      )
    ),
    h(
      "tbody",
      {},
      rows.map((r) =>
        h(
          "tr",
          {},
          r.map((c) => h("td", {}, c))
        )
      )
    )
  )

const eventLink = (id) =>
  h(
    "a",
    { href: `#events/${encodeURIComponent(id)}` },
    byId("events", id)?.title ?? id
  )

const sourcesView = () =>
  h(
    "section",
    {},
    h("h2", {}, `出典 ${state.db.sources.length}件`),
    table(
      ["タイトル", "種別", "配信元", "公開", "取得", "処理", "イベント"],
      [...state.db.sources]
        .reverse()
        .map((s) => [
          h(
            "a",
            { href: s.url, target: "_blank", rel: "noopener noreferrer" },
            s.title
          ),
          label("sourceTypes", s.sourceType),
          s.publisher ?? "—",
          fmt(s.publishedAt),
          fmt(s.fetchedAt),
          s.processingStatus,
          h("span", {}, s.relatedEventIds.map(eventLink)),
        ])
    )
  )

const duplicatesView = () =>
  h(
    "section",
    {},
    h("h2", {}, `重複候補 ${state.duplicates.length}件`),
    h(
      "p",
      { class: "meta" },
      "現在のデータから毎回検出（非公開は対象外）。自動統合はしません。同一なら統合先を選んでください。統合先の値が優先され、空欄・出典・関連は統合元から引き継ぎ、統合元は削除されます。"
    ),
    table(
      ["イベント", "候補", "類似度", "理由", "統合"],
      state.duplicates.map((d) => {
        const pub = (id) =>
          label("publicationStatuses", byId("events", id).publication)
        return [
          h("span", {}, eventLink(d.eventId), ` (${pub(d.eventId)})`),
          h(
            "span",
            {},
            eventLink(d.candidateEventId),
            ` (${pub(d.candidateEventId)})`
          ),
          String(d.score),
          d.reasons.join(", "),
          h(
            "span",
            {},
            mergeButton(d.eventId, d.candidateEventId),
            mergeButton(d.candidateEventId, d.eventId)
          ),
        ]
      })
    )
  )

const logView = () =>
  h(
    "section",
    {},
    h("h2", {}, "収集ログ（書き込み・失敗のあった回）"),
    table(
      ["開始", "情報源", "取得", "追加", "要確認", "重複URL", "エラー"],
      [...state.collectLog]
        .reverse()
        .map((l) => [
          fmt(l.startedAt),
          l.sources
            .map(
              (s) =>
                `${s.id}: ${s.status}${s.message ? `（${s.message}）` : ""}`
            )
            .join("\n"),
          String(l.stats?.fetched ?? "—"),
          String(l.stats?.added ?? "—"),
          String(l.stats?.needsReview ?? "—"),
          String(l.stats?.duplicateUrl ?? "—"),
          l.validationErrors.join("\n") || "—",
        ])
    )
  )

const auditView = () =>
  h(
    "section",
    {},
    h("h2", {}, "変更履歴"),
    table(
      ["日時", "対象", "操作", "変更項目", "メモ"],
      [...state.audit].reverse().map((a) => [
        fmt(a.at),
        a.collection === "events" ? eventLink(a.id) : `${a.collection}/${a.id}`,
        {
          create: "作成",
          update: "更新",
          published: "公開",
          hidden: "非公開",
          pending: "承認待ちへ",
        }[a.action] ?? a.action,
        a.changedFields.join(", "),
        a.note ?? "",
      ])
    )
  )

window.addEventListener("hashchange", () => ((notice = null), render()))
load()
  .then(render)
  .catch((e) => (app.textContent = `読み込みに失敗しました: ${e.message}`))
