// 静的データ（R2 またはローカル配信）の取得。地図・詳細表示は Supabase を読まない（CLAUDE.md）
import { useQuery } from '@tanstack/react-query'
import type { Meta, MuniFile, MuniIndexFile, NationalSummary } from '../../shared/types.ts'

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
export const useMuni = (muniKey: string) =>
  useQuery({
    queryKey: ['muni', muniKey],
    queryFn: () => getJson<MuniFile>(`/facilities/by-muni/${encodeURIComponent(muniKey)}.json`),
    staleTime: STALE,
    enabled: /^\d{5}$/.test(muniKey),
  })
