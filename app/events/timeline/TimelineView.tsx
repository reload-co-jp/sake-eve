"use client"

import Link from "next/link"
import { CSSProperties, FC } from "react"
import { SearchForm } from "@/components/SearchForm"
import { ViewTabs } from "@/components/ViewTabs"
import { hrefWith, useEventSearch } from "@/components/useEventSearch"
import { effectiveStatus, formatPeriod, jstDate } from "@/lib/event"
import {
  SCALES,
  alignStart,
  buildTimeline,
  shiftWindow,
  type Scale,
} from "@/lib/timeline"
import { EVENT_STATUSES, GENRES, type Event } from "@/lib/types"

const PATH = "/events/timeline/"
const isScale = (s: string | null): s is Scale => !!s && s in SCALES

export const TimelineView: FC<{
  events: Event[]
  extraText: Record<string, string>
}> = ({ events, extraText }) => {
  const { params, query, results } = useEventSearch(events, extraText, {
    includeEnded: true,
  })
  const scale: Scale = isScale(params.get("scale"))
    ? (params.get("scale") as Scale)
    : "week"
  const today = jstDate(new Date())
  const rawStart = params.get("start")
  const start = alignStart(
    rawStart && /^\d{4}-\d{2}-\d{2}$/.test(rawStart)
      ? rawStart
      : query.from || today,
    scale
  )
  const { days, end, ticks, bars } = buildTimeline(results, scale, start)
  const px = SCALES[scale].px
  const todayOffset = (Date.parse(today) - Date.parse(start)) / 86_400_000
  const style = { "--track": `${days * px}px` } as CSSProperties

  return (
    <>
      <ViewTabs current={PATH} params={params} />
      <SearchForm
        key={params.toString()}
        defaults={query}
        action={PATH}
        hidden={{ scale }}
      />
      <div className="timeline-controls">
        <nav aria-label="表示単位" className="seg">
          {(Object.keys(SCALES) as Scale[]).map((s) => (
            <Link
              key={s}
              href={hrefWith(PATH, params, { scale: s, start })}
              aria-current={s === scale ? "page" : undefined}
            >
              {SCALES[s].label}
            </Link>
          ))}
        </nav>
        <nav aria-label="期間移動" className="seg">
          <Link
            href={hrefWith(PATH, params, {
              start: shiftWindow(start, scale, -1),
            })}
          >
            ← 前へ
          </Link>
          <Link href={hrefWith(PATH, params, { start: null })}>今日</Link>
          <Link
            href={hrefWith(PATH, params, {
              start: shiftWindow(start, scale, 1),
            })}
          >
            次へ →
          </Link>
        </nav>
      </div>
      <h2 aria-live="polite">
        {start.replaceAll("-", "/")} 〜 {end.replaceAll("-", "/")}：
        {bars.length}件
        <small className="sub-count">
          （日程不明のイベントは表示していません）
        </small>
      </h2>

      {bars.length === 0 ? (
        <p>この期間に該当するイベントはありません。</p>
      ) : (
        <div className="timeline" style={style}>
          <div className="tl-row tl-head" aria-hidden="true">
            <div className="tl-label">イベント</div>
            <div className="tl-track">
              {ticks.map((t) => (
                <span
                  key={t.offset}
                  className="tl-tick"
                  style={{ left: t.offset * px }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>
          <ul className="tl-body">
            {bars.map((b) => {
              const status = effectiveStatus(b.event)
              return (
                <li key={b.event.id} className="tl-row">
                  <div className="tl-label">
                    <span className="tl-title">{b.event.title}</span>
                    <span className="tl-genres">
                      {b.event.genres.map((g) => GENRES[g]).join("・")}
                    </span>
                    <span className="tl-status">{EVENT_STATUSES[status]}</span>
                  </div>
                  <div className="tl-track">
                    {ticks.map((t) => (
                      <span
                        key={t.offset}
                        className="tl-grid"
                        style={{ left: t.offset * px }}
                      />
                    ))}
                    {todayOffset >= 0 && todayOffset < days && (
                      <span
                        className="tl-today"
                        style={{ left: todayOffset * px }}
                      />
                    )}
                    <Link
                      href={`/events/${b.event.slug}/`}
                      className={`tl-bar genre-${b.event.genres[0]} tl-${status}`}
                      style={{ left: b.offset * px, width: b.span * px }}
                      title={`${b.event.title}（${formatPeriod(b.event)}）`}
                    >
                      {b.continuesBefore && "◀ "}
                      {b.event.title}
                      <span className="visually-hidden">
                        （{formatPeriod(b.event)}）
                      </span>
                      {b.continuesAfter && " ▶"}
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </>
  )
}
