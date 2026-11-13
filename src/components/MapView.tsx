import { useEffect, useRef } from 'react'
import { ja } from '../i18n/ja.ts'
import { createMapAdapter, type MapAdapter, type MapFeature, type MapFilter, type MapMountOptions } from '../lib/map/index.ts'

type Props = {
  className?: string
  label: string
  filter?: MapFilter
  selectedId?: string | null
  onSelect?: (f: MapFeature | null) => void
} & (
  | { mode: 'national'; tilesUrl: string }
  | { mode: 'single'; lat: number; lng: number; state: MapFeature['state']; restrictedOnly: boolean }
)

const labels = {
  zoomIn: ja.map.zoomIn,
  zoomOut: ja.map.zoomOut,
  locate: ja.map.locate,
  locateUnavailable: ja.map.locateUnavailable,
  attributionBase: ja.map.attributionBase,
  attributionData: ja.map.attributionData,
}

/** 地図を表示する。実体は MapAdapter 経由（CLAUDE.md 絶対ルール 10） */
export function MapView(props: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<MapAdapter | null>(null)
  const latest = useRef(props)
  useEffect(() => { latest.current = props })

  const mountKey =
    props.mode === 'national' ? `n:${props.tilesUrl}` : `s:${props.lat},${props.lng},${props.state},${props.restrictedOnly}`

  useEffect(() => {
    let cancelled = false
    let adapter: MapAdapter | null = null
    void createMapAdapter().then((a) => {
      if (cancelled || !ref.current) return
      adapter = a
      adapterRef.current = a
      const p = latest.current
      const options: MapMountOptions =
        p.mode === 'national'
          ? { mode: 'national', tilesUrl: p.tilesUrl, labels }
          : { mode: 'single', lat: p.lat, lng: p.lng, state: p.state, restrictedOnly: p.restrictedOnly, labels }
      a.mount(ref.current, options)
      a.onSelect((f) => latest.current.onSelect?.(f))
      if (p.filter) a.setFilter(p.filter)
      a.setSelected(p.selectedId ?? null)
    })
    return () => {
      cancelled = true
      adapter?.destroy()
      adapterRef.current = null
    }
  }, [mountKey])

  useEffect(() => {
    if (props.filter) adapterRef.current?.setFilter(props.filter)
  }, [props.filter])
  useEffect(() => {
    adapterRef.current?.setSelected(props.selectedId ?? null)
  }, [props.selectedId])

  // 地図ライブラリが要素の position を上書きするので、配置用の外枠と地図用の内枠を分ける
  return (
    <div className={props.className}>
      <div ref={ref} className="h-full w-full" role="application" aria-label={props.label} />
    </div>
  )
}
