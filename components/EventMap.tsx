"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl"
import { FC, useEffect, useRef, useState } from "react"

export type MapPoint = {
  id: string
  href: string
  title: string
  period: string
  place: string
  genres: string
  longitude: number
  latitude: number
}

// GSI tiles: free incl. commercial use with attribution
// (https://maps.gsi.go.jp/development/ichiran.html).
const STYLE = {
  version: 8 as const,
  sources: {
    gsi: {
      type: "raster" as const,
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 18,
      attribution:
        '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>',
    },
  },
  layers: [{ id: "gsi", type: "raster" as const, source: "gsi" }],
}
const JAPAN = { center: [137.5, 37.5] as [number, number], zoom: 4 }

const toGeoJson = (points: MapPoint[]) => ({
  type: "FeatureCollection" as const,
  features: points.map((p) => ({
    type: "Feature" as const,
    properties: { id: p.id },
    geometry: {
      type: "Point" as const,
      coordinates: [p.longitude, p.latitude],
    },
  })),
})

/** Popup built with DOM APIs (text only), never innerHTML, since titles come from external sources. */
const popupContent = (p: MapPoint) => {
  const root = document.createElement("div")
  root.className = "map-popup"
  const a = document.createElement("a")
  a.href = p.href
  a.textContent = p.title
  const lines = [p.period, p.place, p.genres].map((t) => {
    const el = document.createElement("p")
    el.textContent = t
    return el
  })
  root.append(a, ...lines)
  return root
}

export const EventMap: FC<{
  points: MapPoint[]
  label: string
  zoom?: number
}> = ({ points, label, zoom = 13 }) => {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const latest = useRef(points)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    latest.current = points
  }, [points])

  useEffect(() => {
    let cancelled = false
    import("maplibre-gl")
      .then(({ Map, NavigationControl, Popup }) => {
        if (cancelled || !container.current) return
        const m = new Map({
          container: container.current,
          style: STYLE,
          ...JAPAN,
        })
        map.current = m
        m.addControl(new NavigationControl({ showCompass: false }))
        m.on("load", () => {
          m.addSource("events", {
            type: "geojson",
            data: toGeoJson([]),
            cluster: true,
            clusterRadius: 40,
          })
          // No glyphs with raster tiles, so clusters show size instead of a number.
          m.addLayer({
            id: "clusters",
            type: "circle",
            source: "events",
            filter: ["has", "point_count"],
            paint: {
              "circle-color": "#8b6020",
              "circle-opacity": 0.85,
              "circle-stroke-color": "#fdfaf7",
              "circle-stroke-width": 3,
              "circle-radius": [
                "step",
                ["get", "point_count"],
                16,
                5,
                22,
                20,
                30,
              ],
            },
          })
          m.addLayer({
            id: "points",
            type: "circle",
            source: "events",
            filter: ["!", ["has", "point_count"]],
            paint: {
              "circle-color": "#0e473f",
              "circle-radius": 9,
              "circle-stroke-color": "#fdfaf7",
              "circle-stroke-width": 3,
            },
          })
          m.on("click", "clusters", async (e) => {
            const f = e.features?.[0]
            if (!f) return
            const src = m.getSource("events") as GeoJSONSource
            const z = await src.getClusterExpansionZoom(f.properties.cluster_id)
            m.easeTo({
              center: (f.geometry as { coordinates: [number, number] })
                .coordinates,
              zoom: z,
            })
          })
          m.on("click", "points", (e) => {
            const f = e.features?.[0]
            const p = latest.current.find((x) => x.id === f?.properties.id)
            if (!p) return
            new Popup({ offset: 12 })
              .setLngLat([p.longitude, p.latitude])
              .setDOMContent(popupContent(p))
              .addTo(m)
          })
          for (const layer of ["clusters", "points"]) {
            m.on(
              "mouseenter",
              layer,
              () => (m.getCanvas().style.cursor = "pointer")
            )
            m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""))
          }
          setReady(true)
        })
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Refit only when the set of points changes, not on every parent render.
  const signature = points.map((p) => p.id).join(",")
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const points = latest.current
    ;(m.getSource("events") as GeoJSONSource).setData(toGeoJson(points))
    if (points.length === 1) {
      m.jumpTo({ center: [points[0].longitude, points[0].latitude], zoom })
    } else if (points.length > 1) {
      const lng = points.map((p) => p.longitude)
      const lat = points.map((p) => p.latitude)
      m.fitBounds(
        [
          [Math.min(...lng), Math.min(...lat)],
          [Math.max(...lng), Math.max(...lat)],
        ],
        { padding: 60, maxZoom: 12, duration: 0 }
      )
    } else {
      m.jumpTo(JAPAN)
    }
  }, [ready, signature, zoom])

  return failed ? (
    <p className="note">地図を表示できませんでした。</p>
  ) : (
    <div
      ref={container}
      className="event-map"
      role="region"
      aria-label={label}
    />
  )
}
