import { FC } from "react"
import { parseQuery, type EventQuery } from "@/lib/event"
import {
  EVENT_STATUSES,
  EVENT_TYPES,
  GENRES,
  PREFECTURES,
  type EventStatus,
  type EventType,
  type Genre,
} from "@/lib/types"

const EMPTY = parseQuery(new URLSearchParams())

const Checks = <K extends string>({
  name,
  legend,
  options,
  checked,
}: {
  name: string
  legend: string
  options: Record<K, string>
  checked: K[]
}) => (
  <fieldset className="field field-wide">
    <legend>{legend}</legend>
    <div className="checks">
      {(Object.entries(options) as [K, string][]).map(([value, label]) => (
        <label key={value} className="check">
          <input
            type="checkbox"
            name={name}
            value={value}
            defaultChecked={checked.includes(value)}
          />
          {label}
        </label>
      ))}
    </div>
  </fieldset>
)

/**
 * Plain GET form: the query string is the single source of search state, shared by
 * the list, map and timeline pages (`action` picks the target page).
 */
export const SearchForm: FC<{
  defaults?: EventQuery
  action?: string
  /** Extra params to keep, e.g. the timeline scale. */
  hidden?: Record<string, string>
}> = ({ defaults = EMPTY, action = "/events/", hidden = {} }) => {
  const advanced =
    !!defaults.city ||
    defaults.types.length > 0 ||
    defaults.statuses.length > 0 ||
    defaults.freeOnly ||
    defaults.noReservationOnly ||
    defaults.sort !== "start"
  return (
    <form className="search" action={action} method="get" role="search">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="field field-wide">
        <label htmlFor="q">キーワード</label>
        <input
          id="q"
          name="q"
          type="search"
          placeholder="イベント名・会場・主催者・出店者・商品"
          defaultValue={defaults.q}
        />
      </div>
      <div className="field">
        <label htmlFor="pref">都道府県</label>
        <select id="pref" name="pref" defaultValue={defaults.pref}>
          <option value="">すべて</option>
          {PREFECTURES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="from">開催期間（から）</label>
        <input id="from" name="from" type="date" defaultValue={defaults.from} />
      </div>
      <div className="field">
        <label htmlFor="to">開催期間（まで）</label>
        <input id="to" name="to" type="date" defaultValue={defaults.to} />
      </div>
      <Checks<Genre>
        name="genre"
        legend="酒類ジャンル（複数選択可）"
        options={GENRES}
        checked={defaults.genres}
      />
      <details className="field-wide advanced" open={advanced}>
        <summary>詳細条件</summary>
        <div className="advanced__body">
          <div className="field">
            <label htmlFor="city">市区町村</label>
            <input
              id="city"
              name="city"
              type="text"
              placeholder="例: 台東区"
              defaultValue={defaults.city}
            />
          </div>
          <div className="field">
            <label htmlFor="sort">並び順</label>
            <select id="sort" name="sort" defaultValue={defaults.sort}>
              <option value="start">開催日順</option>
              <option value="new">新着順</option>
            </select>
          </div>
          <Checks<EventType>
            name="type"
            legend="イベント形式"
            options={EVENT_TYPES}
            checked={defaults.types}
          />
          <Checks<EventStatus>
            name="status"
            legend="開催状況（未選択時は終了以外）"
            options={EVENT_STATUSES}
            checked={defaults.statuses}
          />
          <fieldset className="field field-wide">
            <legend>入場料・予約（情報があるイベントのみ）</legend>
            <div className="checks">
              <label className="check">
                <input
                  type="checkbox"
                  name="free"
                  value="1"
                  defaultChecked={defaults.freeOnly}
                />
                入場無料
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  name="noresv"
                  value="1"
                  defaultChecked={defaults.noReservationOnly}
                />
                予約不要
              </label>
            </div>
          </fieldset>
        </div>
      </details>
      <div className="actions field-wide">
        <button type="submit">この条件で探す</button>
        <a href={action}>条件をクリア</a>
      </div>
    </form>
  )
}
