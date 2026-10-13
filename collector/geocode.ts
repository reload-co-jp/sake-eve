import type { FetchText } from "./http.ts"

/** 国土地理院 住所検索API (no key; CORS open). The admin UI calls the same endpoint. */
export const GSI_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch"

type Feature = { geometry?: { coordinates?: [number, number] } }

/** First hit of a GSI response as lat/lng, or null. */
export const parseGsi = (json: string) => {
  const [lng, lat] =
    (JSON.parse(json) as Feature[])[0]?.geometry?.coordinates ?? []
  return typeof lat === "number" && typeof lng === "number"
    ? { latitude: lat, longitude: lng }
    : null
}

/** GSI finds nothing when a postal code leads the address. */
export const stripPostal = (address: string) =>
  address.replace(/〒?\s*\d{3}[-－−‐]\d{4}/, "").trim()

export const geocode = async (fetchText: FetchText, address: string) =>
  parseGsi(
    await fetchText(`${GSI_URL}?q=${encodeURIComponent(stripPostal(address))}`)
  )
