export const GENRES = {
  beer: "ビール",
  wine: "ワイン",
  whisky: "ウイスキー",
  sake: "日本酒",
  shochu: "焼酎",
  awamori: "泡盛",
  gin: "ジン",
  cocktail: "カクテル",
  other: "その他",
} as const
export type Genre = keyof typeof GENRES

export const EVENT_TYPES = {
  festival: "フェス",
  tasting: "試飲会",
  brewery_open_day: "酒蔵・醸造所開放",
  seminar: "セミナー",
  tour: "見学ツアー",
  market: "マーケット",
  other: "その他",
} as const
export type EventType = keyof typeof EVENT_TYPES

export const EVENT_STATUSES = {
  scheduled: "開催予定",
  ongoing: "開催中",
  ended: "終了",
  cancelled: "中止",
  postponed: "延期",
  unknown: "未確定",
} as const
export type EventStatus = keyof typeof EVENT_STATUSES

export const VERIFICATION_STATUSES = {
  unverified: "未確認",
  partially_verified: "一部確認済み",
  verified: "確認済み",
  needs_review: "要確認",
} as const
export type VerificationStatus = keyof typeof VERIFICATION_STATUSES

/** Publication (approval) state, separate from fact verification. */
export const PUBLICATION_STATUSES = {
  pending: "承認待ち",
  published: "公開",
  hidden: "非公開",
} as const
export type PublicationStatus = keyof typeof PUBLICATION_STATUSES

export const SOURCE_TYPES = {
  prtimes: "PR TIMES",
  google_news: "Google News",
  official: "公式発表",
  manual: "手動登録",
  news: "報道・ウェブ記事",
  sample: "サンプル",
} as const
export type SourceType = keyof typeof SOURCE_TYPES

export const PROCESSING_STATUSES = [
  "new",
  "processed",
  "needs_review",
  "ignored",
  "error",
] as const
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number]

export const ARTICLE_TYPES = {
  event_guide: "イベント紹介",
  report: "イベントレポート",
  producer: "出店者紹介",
  product: "新商品紹介",
  feature: "特集・まとめ",
} as const
export type ArticleType = keyof typeof ARTICLE_TYPES

export const PRODUCER_TYPES = {
  brewery: "ブルワリー",
  winery: "ワイナリー",
  distillery: "蒸留所",
  sake_brewery: "酒蔵",
  other: "その他",
} as const
export type ProducerType = keyof typeof PRODUCER_TYPES

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const // prettier-ignore

/** ISO 8601 with timezone offset, e.g. 2026-10-10T11:00:00+09:00 */
export type IsoDateTime = string

export type Venue = {
  name: string | null
  address: string | null
  prefecture: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
}

export type Event = {
  id: string
  slug: string
  title: string
  description: string | null
  genres: Genre[]
  eventTypes: EventType[]
  startAt: IsoDateTime | null
  endAt: IsoDateTime | null
  venue: Venue
  organizer: string | null
  officialUrl: string | null
  ticketUrl: string | null
  /** Admission as stated by the source, e.g. "前売2,000円". */
  price: string | null
  isFree: boolean | null
  reservationRequired: boolean | null
  sourceIds: string[]
  producerIds: string[]
  productIds: string[]
  articleIds: string[]
  status: EventStatus
  verificationStatus: VerificationStatus
  lastVerifiedAt: IsoDateTime | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  /** true = only dates are known; startAt/endAt times carry no meaning. */
  dateOnly: boolean
  /** true = fictional data for development, never a real event. */
  isSample: boolean
  /** Only "published" events appear on the site. */
  publication: PublicationStatus
}

export type Source = {
  id: string
  sourceType: SourceType
  url: string
  title: string
  publisher: string | null
  publishedAt: IsoDateTime | null
  fetchedAt: IsoDateTime
  contentHash: string | null
  relatedEventIds: string[]
  processingStatus: ProcessingStatus
  extractedFields: Record<string, unknown> | null
}

export type Article = {
  id: string
  slug: string
  title: string
  summary: string
  body: string
  thumbnail: string | null
  articleType: ArticleType
  eventIds: string[]
  producerIds: string[]
  productIds: string[]
  sourceIds: string[]
  publishedAt: IsoDateTime
  updatedAt: IsoDateTime
  isSample: boolean
}

export type Producer = {
  id: string
  slug: string
  name: string
  aliases: string[]
  producerType: ProducerType
  address: string | null
  prefecture: string | null
  officialUrl: string | null
  genres: Genre[]
  productIds: string[]
  eventIds: string[]
  articleIds: string[]
  isSample: boolean
}

export type Product = {
  id: string
  slug: string
  name: string
  producerId: string | null
  genres: Genre[]
  description: string | null
  releaseDate: string | null
  officialUrl: string | null
  eventIds: string[]
  articleIds: string[]
  sourceIds: string[]
  isSample: boolean
}

export type Db = {
  events: Event[]
  sources: Source[]
  articles: Article[]
  producers: Producer[]
  products: Product[]
}

/** Decorative English labels for section headings. */
export const GENRES_EN: Record<Genre, string> = {
  beer: "Beer",
  wine: "Wine",
  whisky: "Whisky",
  sake: "Sake",
  shochu: "Shochu",
  awamori: "Awamori",
  gin: "Gin",
  cocktail: "Cocktail",
  other: "Others",
}

export const REGIONS: { name: string; prefectures: string[] }[] = [
  { name: "北海道・東北", prefectures: ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"] },
  { name: "関東", prefectures: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"] },
  { name: "中部", prefectures: ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"] },
  { name: "近畿", prefectures: ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"] },
  { name: "中国・四国", prefectures: ["鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県"] },
  { name: "九州・沖縄", prefectures: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"] },
] // prettier-ignore

/** URL slugs for /areas/{prefecture}/ (order matches PREFECTURES). */
const PREFECTURE_SLUG_LIST = [
  "hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima",
  "ibaraki", "tochigi", "gunma", "saitama", "chiba", "tokyo", "kanagawa",
  "niigata", "toyama", "ishikawa", "fukui", "yamanashi", "nagano", "gifu",
  "shizuoka", "aichi", "mie", "shiga", "kyoto", "osaka", "hyogo",
  "nara", "wakayama", "tottori", "shimane", "okayama", "hiroshima", "yamaguchi",
  "tokushima", "kagawa", "ehime", "kochi", "fukuoka", "saga", "nagasaki",
  "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa",
] // prettier-ignore
export const PREFECTURE_SLUGS: Record<string, string> = Object.fromEntries(
  PREFECTURES.map((p, i) => [p, PREFECTURE_SLUG_LIST[i]])
)
export const PREFECTURE_BY_SLUG: Record<string, string> = Object.fromEntries(
  PREFECTURES.map((p, i) => [PREFECTURE_SLUG_LIST[i], p])
)
