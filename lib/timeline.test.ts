import { describe, expect, it } from "vitest"
import events from "@/test/fixtures/events.json"
import { alignStart, buildTimeline, shiftWindow } from "./timeline"
import type { Event } from "./types"

const all = events as unknown as Event[]

describe("timeline", () => {
  it("aligns window starts", () => {
    expect(alignStart("2026-10-10", "week")).toBe("2026-10-05") // Monday
    expect(alignStart("2026-10-10", "month")).toBe("2026-10-01")
    expect(shiftWindow("2026-10-01", "month", 1)).toBe("2027-10-01")
    expect(shiftWindow("2026-10-05", "week", -1)).toBe("2026-07-13")
  })

  it("clips multi-day bars to the window and skips undated events", () => {
    const { bars, ticks } = buildTimeline(all, "day", "2026-10-11")
    const byId = Object.fromEntries(bars.map((b) => [b.event.id, b]))
    // 10/10-10/12 starts before the window
    expect(byId["evt-sample-0003"]).toMatchObject({
      offset: 0,
      span: 2,
      continuesBefore: true,
    })
    // 10/17-10/18 one-day vs two-day bars on the same axis
    expect(byId["evt-sample-0001"]).toMatchObject({ offset: 6, span: 2 })
    expect(byId["evt-sample-0007"]).toMatchObject({ offset: 13, span: 1 })
    expect(byId["evt-sample-0005"]).toBeUndefined() // no dates
    expect(byId["evt-sample-0002"]).toBeUndefined() // outside window
    expect(ticks[0].label).toBe("10/11(日)")
  })

  it("labels weeks on Mondays and months on the 1st", () => {
    expect(buildTimeline([], "week", "2026-10-05").ticks[0].label).toBe(
      "10/5〜"
    )
    expect(
      buildTimeline([], "month", "2026-10-01")
        .ticks.map((t) => t.label)
        .slice(0, 2)
    ).toEqual(["2026年10月", "2026年11月"])
  })
})
