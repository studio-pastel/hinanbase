import type { MapAdapter } from './MapAdapter.ts'

export type { MapAdapter, MapFeature, MapFilter, MapLabels, MapMountOptions } from './MapAdapter.ts'
export { clusterCountAttributes, isClusterCountUnavailable } from './MapAdapter.ts'

/** 地図ライブラリは大きいので、必要になったときに読み込む */
export async function createMapAdapter(): Promise<MapAdapter> {
  const { MapLibreAdapter } = await import('./MapLibreAdapter.ts')
  return new MapLibreAdapter()
}
