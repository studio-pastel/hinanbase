// 静的データ（R2 またはローカル配信）の取得。地図・詳細表示は Supabase を読まない（CLAUDE.md）
import { useQuery } from '@tanstack/react-query'
import type { GeocodeFile, PointRow } from '../../shared/geocode.ts'
import type { EvacueeEstimates, Meta, MuniFile, MuniIndexFile, NationalSummary } from '../../shared/types.ts'

export const DATA_BASE_URL = (import.meta.env.VITE_DATA_BASE_URL ?? '').replace(/\/+$/, '')

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DATA_BASE_URL}${path}`)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return (await res.json()) as T
}

const STALE = 5 * 60 * 1000

export const useNational = () =>
  useQuery({ queryKey: ['national'], queryFn: () => getJson<NationalSummary>('/summary/national.json'), staleTime: STALE })
export const useMeta = () =>
  useQuery({ queryKey: ['meta'], queryFn: () => getJson<Meta>('/meta.json'), staleTime: STALE })
export const useMuniIndex = () =>
  useQuery({ queryKey: ['munis'], queryFn: () => getJson<MuniIndexFile>('/summary/munis.json'), staleTime: STALE })
export const useEvacueeEstimates = () =>
  useQuery({ queryKey: ['evacuees'], queryFn: () => getJson<EvacueeEstimates>('/summary/evacuee-estimates.json'), staleTime: STALE, retry: 1 })
/** 住所照合用ファイル（都道府県単位）。取得するのは都道府県のファイルだけで、住所は送らない（SPEC §6.6） */
export const fetchGeocode = (prefCode: string) => getJson<GeocodeFile>(`/geocode/${encodeURIComponent(prefCode)}.json`)

/** 施設の位置（緯度経度 1 度の区画ごと）。施設のない区画（海など）はファイルがないので空として扱う */
export async function fetchPoints(cells: string[]): Promise<PointRow[]> {
  const parts = await Promise.all(cells.map(async (c) => {
    const res = await fetch(`${DATA_BASE_URL}/points/${encodeURIComponent(c)}.json`)
    if (res.status === 404 || res.status === 403) return []
    if (!res.ok) throw new Error(`points/${c}: ${res.status}`)
    return (await res.json()) as PointRow[]
  }))
  return parts.flat()
}

export const useMuni = (muniKey: string) =>
  useQuery({
    queryKey: ['muni', muniKey],
    queryFn: () => getJson<MuniFile>(`/facilities/by-muni/${encodeURIComponent(muniKey)}.json`),
    staleTime: STALE,
    enabled: /^\d{5}$/.test(muniKey),
  })
