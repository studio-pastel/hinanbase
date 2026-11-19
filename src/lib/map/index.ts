import type { MapAdapter } from './MapAdapter.ts'

export type { ColorBy, HazardOverlay, MapAdapter, MapFeature, MapFilter, MapLabels, MapMountOptions } from './MapAdapter.ts'
export { COLOR_BYS, HAZARD_OVERLAYS, METRIC_SCALES, METRIC_UNKNOWN_COLOR, clusterCountAttributes, isClusterCountUnavailable } from './MapAdapter.ts'

/** 地図ライブラリは大きいので、必要になったときに読み込む */
export async function createMapAdapter(): Promise<MapAdapter> {
  const { MapLibreAdapter } = await import('./MapLibreAdapter.ts')
  return new MapLibreAdapter()
}
