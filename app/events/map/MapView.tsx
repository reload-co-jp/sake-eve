"use client"

import Link from "next/link"
import { FC } from "react"
import { EventMap } from "@/components/EventMap"
import { SearchForm } from "@/components/SearchForm"
import { ViewTabs } from "@/components/ViewTabs"
import { useEventSearch } from "@/components/useEventSearch"
import { formatPeriod, toMapPoint } from "@/lib/event"
import type { Event } from "@/lib/types"

export const MapView: FC<{
  events: Event[]
  extraText: Record<string, string>
}> = ({ events, extraText }) => {
  const { params, query, results } = useEventSearch(events, extraText)
  const key = params.toString()
  const points = results.map(toMapPoint).filter((p) => p !== null)
  const mapped = new Set(points.map((p) => p.id))
  return (
    <>
      <SearchForm key={key} defaults={query} action="/events/map/" />
      <ViewTabs current="/events/map/" params={params} />
      <h2 aria-live="polite">
        地図に表示 {points.length}件
        <small className="sub-count">
          （会場の座標が不明な{results.length - points.length}
          件は表示していません）
        </small>
      </h2>
      <EventMap points={points} label="イベント会場の地図" />
      <p className="note">
        ピンを選ぶとイベント情報を表示します。複数の会場が近い場合はまとめて表示し、選ぶと拡大します（円が大きいほど件数が多い）。
      </p>
      <h3 className="list-head">地図に表示中のイベント</h3>
      <ul className="compact-list">
        {results
          .filter((e) => mapped.has(e.id))
          .map((e) => (
            <li key={e.id}>
              <Link href={`/events/${e.slug}/`}>{e.title}</Link>
              <span>
                {formatPeriod(e)} ／ {e.venue.prefecture} {e.venue.name}
              </span>
            </li>
          ))}
      </ul>
    </>
  )
}
