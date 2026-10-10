"use client"

import { useSearchParams } from "next/navigation"
import { filterEvents, parseQuery } from "@/lib/event"
import type { Event } from "@/lib/types"

/** Search state shared by the list, map and timeline views (all read the URL query). */
export const useEventSearch = (
  events: Event[],
  extraText: Record<string, string>,
  /** Views with their own time axis (timeline) show ended events by default. */
  opts: { includeEnded?: boolean } = {}
) => {
  const params = useSearchParams()
  const query = { ...parseQuery(params) }
  if (opts.includeEnded) query.includeEnded = true
  return {
    params,
    query,
    results: filterEvents(events, query, new Date(), extraText),
  }
}

/** Current query with some params replaced (null removes). */
export const hrefWith = (
  path: string,
  params: URLSearchParams,
  patch: Record<string, string | null>
) => {
  const next = new URLSearchParams(params)
  for (const [k, v] of Object.entries(patch))
    if (v === null) next.delete(k)
    else next.set(k, v)
  const qs = next.toString()
  return qs ? `${path}?${qs}` : path
}
