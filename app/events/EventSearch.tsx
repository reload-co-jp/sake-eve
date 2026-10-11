"use client"

import Link from "next/link"
import { FC } from "react"
import { EventList } from "@/components/EventCard"
import { EventMap } from "@/components/EventMap"
import { SearchForm } from "@/components/SearchForm"
import { ViewTabs } from "@/components/ViewTabs"
import { hrefWith, useEventSearch } from "@/components/useEventSearch"
import { toMapPoint } from "@/lib/event"
import type { Event } from "@/lib/types"

const PER_PAGE = 20

export const EventSearch: FC<{
  events: Event[]
  extraText: Record<string, string>
}> = ({ events, extraText }) => {
  const { params, query, results } = useEventSearch(events, extraText)
  const pages = Math.max(1, Math.ceil(results.length / PER_PAGE))
  const page = Math.min(pages, Math.max(1, Number(params.get("page")) || 1))
  const shown = results.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const points = results.map(toMapPoint).filter((p) => p !== null)
  return (
    <>
      {/* key resets defaultValues on back/forward navigation */}
      <SearchForm key={params.toString()} defaults={query} />
      <ViewTabs current="/events/" params={params} />
      <h2 aria-live="polite">検索結果 {results.length}件</h2>
      {points.length > 0 && (
        <EventMap points={points} label="検索結果のイベント会場の地図" />
      )}
      {shown.length > 0 ? (
        <EventList events={shown} />
      ) : (
        <p>
          条件に合うイベントが見つかりませんでした。条件を変えてお試しください。
        </p>
      )}
      {pages > 1 && (
        <nav aria-label="ページ" className="pager">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Link
              key={n}
              href={hrefWith("/events/", params, {
                page: n === 1 ? null : String(n),
              })}
              aria-current={n === page ? "page" : undefined}
            >
              {n}
            </Link>
          ))}
        </nav>
      )}
    </>
  )
}
