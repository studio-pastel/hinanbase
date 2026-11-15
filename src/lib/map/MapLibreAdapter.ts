import {
  AttributionControl, GeolocateControl, Map as MapLibreMap, NavigationControl, addProtocol, setWorkerUrl,
  type ExpressionSpecification, type FilterSpecification, type MapGeoJSONFeature,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Point } from 'geojson'
import { Protocol } from 'pmtiles'
import { DISPLAY_STATES, HAZARD_KEYS, type DisplayState } from '../../../shared/types.ts'
import { ICON_PIXEL_RATIO, clusterIcon, markerIcon, selectedIcon } from './icons.ts'
import { clusterCountAttributes, type MapAdapter, type MapFeature, type MapFilter, type MapMountOptions } from './MapAdapter.ts'

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
const SOURCE = 'shelters'
const LAYER_CLUSTERS = 'shelter-clusters'
const LAYER_POINTS = 'shelter-points'
const LAYER_SELECTED = 'shelter-selected'

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

export class MapLibreAdapter implements MapAdapter {
  private map: MapLibreMap | null = null
  private filter: MapFilter = { kind: 'all', hazard: 'all', states: [...DISPLAY_STATES], ac: 'all', overlap: 'all' }
  private selectedId: string | null = null
  private selectCallback: ((f: MapFeature | null) => void) | null = null
  private loaded = false

  mount(container: HTMLElement, options: MapMountOptions): void {
    ensureProtocol()
    const { labels } = options
    const single = options.mode === 'single'
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
      center: single ? [options.lng, options.lat] : [137.2, 37.6],
      zoom: single ? 15 : 4.4,
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
    if (!single) {
      map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'top-right')
    }

    const imageOptions = { pixelRatio: ICON_PIXEL_RATIO }
    // まとめ表示の印（件数入り）は、必要になった時点でキャンバスに描いて登録する
    map.setMissingStyleImageResolver((id) => {
      if (id.startsWith('c-') && !map.hasImage(id)) map.addImage(id, clusterIcon(id.slice(2)), imageOptions)
    })

    map.on('load', () => {
      for (const state of DISPLAY_STATES) {
        map.addImage(`m-${state}-0`, markerIcon(state, false), imageOptions)
        map.addImage(`m-${state}-1`, markerIcon(state, true), imageOptions)
      }
      map.addImage('selected', selectedIcon(), imageOptions)
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
          'icon-image': ['concat', 'm-', ['get', 'state'], '-', ['to-string', ['get', 'rs']]],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 0.8, 15, 1.1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
      map.addLayer({
        id: LAYER_SELECTED, type: 'symbol', source: SOURCE, 'source-layer': 'shelters',
        filter: ['==', ['get', 'id'], ''],
        layout: { 'icon-image': 'selected', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      })
      this.loaded = true
      this.applyFilter()
      this.applySelected()

      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: [LAYER_POINTS, LAYER_CLUSTERS] })
        const hit = hits[0]
        if (!hit) { this.select(null); return }
        if (hit.layer.id === LAYER_CLUSTERS) {
          const [lng, lat] = (hit.geometry as Point).coordinates as [number, number]
          map.easeTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2, 13) })
          return
        }
        this.select(toFeature(hit))
      })
      for (const layer of [LAYER_POINTS, LAYER_CLUSTERS]) {
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

  destroy(): void {
    this.map?.remove()
    this.map = null
    this.loaded = false
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
