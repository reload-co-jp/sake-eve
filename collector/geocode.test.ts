import { describe, expect, it } from "vitest"
import { parseGsi, stripPostal } from "./geocode"

describe("parseGsi", () => {
  it("takes the first hit as lat/lng and returns null without one", () => {
    const hit = `[{"geometry":{"coordinates":[139.773529,35.714279],"type":"Point"}}]`
    expect(parseGsi(hit)).toEqual({
      latitude: 35.714279,
      longitude: 139.773529,
    })
    expect(parseGsi("[]")).toBeNull()
  })
  it("drops a leading postal code", () => {
    expect(stripPostal("〒160-0022 東京都新宿区新宿3丁目")).toBe(
      "東京都新宿区新宿3丁目"
    )
  })
})
