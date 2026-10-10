"use client"

import Link from "next/link"
import { FC } from "react"
import { hrefWith } from "./useEventSearch"

const VIEWS = [
  { path: "/events/", label: "リスト" },
  { path: "/events/map/", label: "地図" },
  { path: "/events/timeline/", label: "タイムライン" },
]

/** Switches views while keeping the search conditions. */
export const ViewTabs: FC<{ current: string; params: URLSearchParams }> = ({
  current,
  params,
}) => (
  <nav aria-label="表示切替" className="view-tabs">
    {VIEWS.map((v) => (
      <Link
        key={v.path}
        href={hrefWith(v.path, params, {
          page: null,
          scale: null,
          start: null,
        })}
        aria-current={v.path === current ? "page" : undefined}
      >
        {v.label}
      </Link>
    ))}
  </nav>
)
