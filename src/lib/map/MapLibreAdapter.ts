import {
  AttributionControl, GeolocateControl, Map as MapLibreMap, NavigationControl, addProtocol, setWorkerUrl,
  type ExpressionSpecification, type FilterSpecification, type MapGeoJSONFeature,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Point } from 'geojson'
import { Protocol } from 'pmtiles'
import { DISPLAY_STATES, HAZARD_KEYS, type DisplayState } from '../../../shared/types.ts'
import { ICON_PIXEL_RATIO, clusterIcon, markerIcon, pinIcon, selectedIcon } from './icons.ts'
import { METRIC_SCALES, METRIC_UNKNOWN_COLOR, clusterCountAttributes, type ColorBy, type HazardOverlay, type MapAdapter, type MapFeature, type MapFilter, type MapMountOptions } from './MapAdapter.ts'

let protocolReady = false
function ensureProtocol() {
  if (protocolReady) return
  setWorkerUrl(workerUrl)
  addProtocol('pmtiles', new Protocol().tile)
  protocolReady = true
}

const BASE_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'
const BASE_ATTRIBUTION_URL = 'https://maps.gsi.go.jp/development/ichiran.html'
const DATA_ATTRIBUTION_URL = 'https://hinanmap.gsi.go.jp/'
const HAZARD_TILE_BASE = 'https://disaportaldata.gsi.go.jp/raster'
const HAZARD_ATTRIBUTION_URL = 'https://disaportal.gsi.go.jp/'
/** 重ねる表示用のタイル。土砂災害は 3 種類を重ねる */
const HAZARD_OVERLAY_LAYERS: Record<HazardOverlay, string[]> = {
  flood: ['01_flood_l2_shinsuishin'],
  landslide: ['05_dosekiryukeikaikuiki', '05_kyukeishakeikaikuiki', '05_jisuberikeikaikuiki'],
  tsunami: ['04_tsunami_newlegend'],
  storm_surge: ['03_hightide_l2_shinsuishin'],
}
const HAZARD_PREFIX = 'hazard-'
const SOURCE = 'shelters'
const LAYER_CLUSTERS = 'shelter-clusters'
const LAYER_POINTS = 'shelter-points'
const LAYER_SELECTED = 'shelter-selected'
const METRIC_SOURCE = 'metric'
const LAYER_METRIC = 'shelter-metric'

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

export class MapLibreAdapter implements MapAdapter {
  private map: MapLibreMap | null = null
  private filter: MapFilter = { kind: 'all', hazard: 'all', states: [...DISPLAY_STATES], ac: 'all', overlap: 'all' }
  private selectedId: string | null = null
  private selectCallback: ((f: MapFeature | null) => void) | null = null
  private pickCallback: ((lat: number, lng: number) => void) | null = null
  private viewCallback: ((lat: number, lng: number, zoom: number) => void) | null = null
  private pin: [number, number] | null = null
  private loaded = false
  private styleReady = false
  private overlay: HazardOverlay | null = null
  private hazardAttribution = ''
  private colorBy: ColorBy = 'state'
  private hasMetric = false

  mount(container: HTMLElement, options: MapMountOptions): void {
    ensureProtocol()
    const { labels } = options
    this.hazardAttribution = `<a href="${HAZARD_ATTRIBUTION_URL}" target="_blank" rel="noopener">${escapeHtml(labels.attributionHazard)}</a>`
    const single = options.mode === 'single'
    const pick = options.mode === 'pick'
    if (pick) this.pin = [options.lng, options.lat]
    const map = new MapLibreMap({
      container,
      style: {
        version: 8,
        sources: {
          base: {
            type: 'raster',
            tiles: [BASE_TILES],
            tileSize: 256,
            minzoom: 2,
            maxzoom: 18,
            attribution: `<a href="${BASE_ATTRIBUTION_URL}" target="_blank" rel="noopener">${escapeHtml(labels.attributionBase)}</a>`,
          },
        },
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
      },
      center: single || pick ? [options.lng, options.lat] : options.view ? [options.view.lng, options.view.lat] : [137.2, 37.6],
      zoom: single ? 15 : pick ? options.zoom : options.view?.zoom ?? 4.4,
      minZoom: 4,
      maxZoom: 18,
      maxBounds: [[110, 15], [165, 52]],
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
      locale: {
        'NavigationControl.ZoomIn': labels.zoomIn,
        'NavigationControl.ZoomOut': labels.zoomOut,
        'GeolocateControl.FindMyLocation': labels.locate,
        'GeolocateControl.LocationNotAvailable': labels.locateUnavailable,
      },
    })
    this.map = map
    map.touchZoomRotate.disableRotation()
    // 出典は折りたたまずに常に表示する（CLAUDE.md 絶対ルール 8）
    map.addControl(new AttributionControl({ compact: false }), 'bottom-right')
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    if (options.mode === 'national') {
      map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'top-right')
    }

    const imageOptions = { pixelRatio: ICON_PIXEL_RATIO }
    // まとめ表示の印（件数入り）は、必要になった時点でキャンバスに描いて登録する
    map.setMissingStyleImageResolver((id) => {
      if (id.startsWith('c-') && !map.hasImage(id)) map.addImage(id, clusterIcon(id.slice(2)), imageOptions)
    })

    map.on('load', () => {
      for (const state of DISPLAY_STATES) {
        for (const rs of [0, 1]) {
          map.addImage(`m-${state}-${rs}`, markerIcon(state, rs === 1), imageOptions)
          map.addImage(`m-${state}-${rs}-a`, markerIcon(state, rs === 1, true), imageOptions)
        }
      }
      map.addImage('selected', selectedIcon(), imageOptions)
      map.addImage('pin', pinIcon(), imageOptions)
      this.styleReady = true
      this.applyOverlay()
      if (options.mode === 'single') {
        map.addSource('single', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'Point', coordinates: [options.lng, options.lat] }, properties: {} },
        })
        map.addLayer({
          id: 'single', type: 'symbol', source: 'single',
          layout: { 'icon-image': `m-${options.state}-${options.restrictedOnly ? 1 : 0}`, 'icon-size': 1.3, 'icon-allow-overlap': true },
        })
        return
      }
      map.addSource(SOURCE, {
        type: 'vector',
        url: `pmtiles://${options.tilesUrl}`,
        attribution: `<a href="${DATA_ATTRIBUTION_URL}" target="_blank" rel="noopener">${escapeHtml(labels.attributionData)}</a>`,
      })
      map.addLayer({
        id: LAYER_CLUSTERS, type: 'symbol', source: SOURCE, 'source-layer': 'shelters',
        layout: { 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      })
      map.addLayer({
        id: LAYER_POINTS, type: 'symbol', source: SOURCE, 'source-layer': 'shelters',
        layout: {
          // 軸A が「要確認」（hm=1）の施設は、表示状態の色とは別に三角の印を重ねる
          'icon-image': ['concat', 'm-', ['get', 'state'], '-', ['to-string', ['get', 'rs']], ['case', ['>', ['coalesce', ['get', 'hm'], 0], 0], '-a', '']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 0.8, 15, 1.1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
      if (options.mode === 'national' && options.pointsUrl) {
        // 色分け用：全施設を点で持つタイル。色分けしている間だけ表示する
        map.addSource(METRIC_SOURCE, { type: 'vector', url: `pmtiles://${options.pointsUrl}` })
        map.addLayer({
          id: LAYER_METRIC, type: 'circle', source: METRIC_SOURCE, 'source-layer': 'shelters',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 8, 2.6, 12, 5, 15, 8],
            'circle-stroke-color': '#333333',
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0.2, 10, 0.6, 14, 1],
          },
        })
        this.hasMetric = true
      }
      map.addLayer({
        id: LAYER_SELECTED, type: 'symbol', source: SOURCE, 'source-layer': 'shelters',
        filter: ['==', ['get', 'id'], ''],
        layout: { 'icon-image': 'selected', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      })
      this.loaded = true
      this.applyColorBy()
      this.applyFilter()
      this.applySelected()
      // 選んだ地点・検索した地点。施設の印より上に描く
      map.addSource('pin', { type: 'geojson', data: this.pinData() })
      map.addLayer({ id: 'pin', type: 'symbol', source: 'pin', layout: { 'icon-image': 'pin', 'icon-allow-overlap': true, 'icon-ignore-placement': true } })
      map.on('moveend', () => {
        const c = map.getCenter()
        this.viewCallback?.(c.lat, c.lng, map.getZoom())
      })

      if (pick) {
        map.on('click', (e) => {
          this.pin = [e.lngLat.lng, e.lngLat.lat]
          this.updatePin()
          this.pickCallback?.(e.lngLat.lat, e.lngLat.lng)
        })
        return
      }

      map.on('click', (e) => {
        const layers = this.colorBy !== 'state' && this.hasMetric ? [LAYER_METRIC] : [LAYER_POINTS, LAYER_CLUSTERS]
        const box: [[number, number], [number, number]] = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]]
        const hits = map.queryRenderedFeatures(layers[0] === LAYER_METRIC ? box : e.point, { layers })
        const hit = hits[0]
        if (!hit) { this.select(null); return }
        if (hit.layer.id === LAYER_CLUSTERS) {
          const [lng, lat] = (hit.geometry as Point).coordinates as [number, number]
          map.easeTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2, 13) })
          return
        }
        this.select(toFeature(hit))
      })
      for (const layer of [LAYER_POINTS, LAYER_CLUSTERS, ...(this.hasMetric ? [LAYER_METRIC] : [])]) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      }
    })
  }

  setFilter(filter: MapFilter): void {
    this.filter = filter
    this.applyFilter()
  }

  onSelect(callback: (feature: MapFeature | null) => void): void {
    this.selectCallback = callback
  }

  setSelected(id: string | null): void {
    this.selectedId = id
    this.applySelected()
  }

  setPin(lat: number, lng: number, zoom?: number): void {
    this.pin = [lng, lat]
    this.updatePin()
    this.map?.easeTo({ center: [lng, lat], ...(zoom !== undefined ? { zoom } : {}) })
  }

  onPick(callback: (lat: number, lng: number) => void): void {
    this.pickCallback = callback
  }

  onViewChange(callback: (lat: number, lng: number, zoom: number) => void): void {
    this.viewCallback = callback
  }

  setHazardOverlay(overlay: HazardOverlay | null): void {
    this.overlay = overlay
    this.applyOverlay()
  }

  setColorBy(colorBy: ColorBy): void {
    this.colorBy = colorBy
    this.applyColorBy()
  }

  /** 色分けの切り替え。指標のときは、まとめ表示と印を隠し、全施設の点を指標の色で描く */
  private applyColorBy() {
    const map = this.map
    if (!map || !this.loaded || !this.hasMetric) return
    const metric = this.colorBy === 'state' ? null : METRIC_SCALES[this.colorBy]
    map.setLayoutProperty(LAYER_METRIC, 'visibility', metric ? 'visible' : 'none')
    map.setLayoutProperty(LAYER_POINTS, 'visibility', metric ? 'none' : 'visible')
    map.setLayoutProperty(LAYER_CLUSTERS, 'visibility', metric ? 'none' : 'visible')
    if (!metric) return
    const value: ExpressionSpecification = ['coalesce', ['get', metric.attr], -1]
    const match = ['match', value, ...metric.colors.flatMap((c, i) => [i, c]), METRIC_UNKNOWN_COLOR] as unknown as ExpressionSpecification
    map.setPaintProperty(LAYER_METRIC, 'circle-color', match)
    // 階級の高い点を上に描く
    map.setLayoutProperty(LAYER_METRIC, 'circle-sort-key', value)
  }

  /** 重ねるハザードマップを入れ替える。地図の下地のすぐ上（施設の印より下）に入れる */
  private applyOverlay() {
    const map = this.map
    if (!map || !this.styleReady) return
    for (const layer of map.getStyle().layers ?? []) {
      if (layer.id.startsWith(HAZARD_PREFIX)) map.removeLayer(layer.id)
    }
    for (const id of Object.keys(map.getStyle().sources ?? {})) {
      if (id.startsWith(HAZARD_PREFIX)) map.removeSource(id)
    }
    if (!this.overlay) return
    const before = map.getStyle().layers?.[1]?.id
    HAZARD_OVERLAY_LAYERS[this.overlay].forEach((name, i) => {
      const id = `${HAZARD_PREFIX}${name}`
      map.addSource(id, {
        type: 'raster',
        tiles: [`${HAZARD_TILE_BASE}/${name}/{z}/{x}/{y}.png`],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 17,
        ...(i === 0 ? { attribution: this.hazardAttribution } : {}),
      })
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0.65 } }, before)
    })
  }

  private pinData() {
    if (!this.pin) return { type: 'FeatureCollection' as const, features: [] }
    return { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: this.pin }, properties: {} }
  }

  private updatePin() {
    const src = this.map?.getSource('pin') as { setData?: (d: unknown) => void } | undefined
    src?.setData?.(this.pinData())
  }

  destroy(): void {
    this.map?.remove()
    this.map = null
    this.loaded = false
    this.styleReady = false
    this.hasMetric = false
  }

  private select(feature: MapFeature | null) {
    this.setSelected(feature?.id ?? null)
    this.selectCallback?.(feature)
  }

  private applySelected() {
    if (!this.map || !this.loaded) return
    this.map.setFilter(LAYER_SELECTED, ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], this.selectedId ?? '']])
  }

  private applyFilter() {
    const map = this.map
    if (!map || !this.loaded) return
    const { kind, hazard, states, ac, overlap } = this.filter

    // 個別の点：属性そのもので正確に絞り込める
    const pointConds: ExpressionSpecification[] = [
      ['!', ['has', 'point_count']],
      ['in', ['get', 'state'], ['literal', states]],
    ]
    if (kind === 'emergency') pointConds.push(['>', ['get', 'ne'], 0])
    if (kind === 'shelter') pointConds.push(['>', ['get', 'ns'], 0])
    if (hazard !== 'all') pointConds.push(['>', ['get', `h${HAZARD_KEYS.indexOf(hazard)}`], 0])
    if (ac === 'none') pointConds.push(['==', ['get', 'ac'], 'none'])
    if (overlap === 'only') pointConds.push(['>', ['get', 'hm'], 0])
    map.setFilter(LAYER_POINTS, ['all', ...pointConds] as FilterSpecification)
    if (this.hasMetric) map.setFilter(LAYER_METRIC, ['all', ...pointConds.slice(1)] as FilterSpecification)

    // まとめ表示：合算済みの属性から件数を出す。条件が 2 つ以上重なると正確な件数は求められないので、
    // 該当しうるまとまりの印だけを件数なしで表示する
    const sums: ExpressionSpecification[] = clusterCountAttributes(this.filter).map((a) =>
      typeof a === 'string'
        ? ['get', a]
        : a.length === 0 ? 0 : (['+', ...a.map((x) => ['coalesce', ['get', x], 0])] as ExpressionSpecification),
    ) as ExpressionSpecification[]
    const count: ExpressionSpecification = sums[0] ?? ['get', 'point_count']
    const positive = (sums.length > 0 ? sums : [count]).map((e): ExpressionSpecification => ['>', e, 0])
    map.setFilter(LAYER_CLUSTERS, ['all', ['has', 'point_count'], ...positive] as FilterSpecification)
    map.setLayoutProperty(LAYER_CLUSTERS, 'icon-image', sums.length <= 1 ? ['concat', 'c-', ['to-string', count]] : 'c-')
  }
}

function toFeature(f: MapGeoJSONFeature): MapFeature {
  const p = f.properties as Record<string, unknown>
  const [lng, lat] = (f.geometry as Point).coordinates as [number, number]
  return {
    id: String(p.id),
    name: String(p.name),
    muni: String(p.muni),
    kind: Number(p.kind),
    hz: Number(p.hz),
    state: p.state as DisplayState,
    restrictedOnly: Number(p.rs) === 1,
    lng,
    lat,
  }
}
