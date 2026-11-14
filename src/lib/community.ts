// 市民投稿・異議・編集履歴の読み書き。書き込みはすべて Supabase の関数（RPC）経由
import { useQuery } from '@tanstack/react-query'
import type { AmenityValue } from '../../shared/types.ts'
import { supabase } from './supabase.ts'

export type AmenityJson = string | number | boolean
export type Basis = 'official_doc' | 'on_site' | 'photo' | 'hearsay'
export type ReportStatus = 'pending' | 'accepted' | 'rejected' | 'superseded'

export interface LiveAmenity extends AmenityValue {
  amenity_key: string
}
export interface PublicReport {
  id: string
  amenity_key: string
  value: AmenityJson
  basis: Basis
  observed_at: string
  status: ReportStatus
  reject_reason: string | null
  created_at: string
  reporter_role: 'user' | 'facility_admin'
  reporter_tag: string
  source_url: string | null
  photo_urls: string[] | null
  note: string | null
}
export interface PublicDispute {
  id: string
  amenity_key: string
  counter_value: AmenityJson | null
  status: 'open' | 'resolved' | 'dismissed'
  resolution_note: string | null
  created_at: string
  raiser_tag: string
}

/** 関数が返したエラー文（日本語）をそのまま取り出す */
export function rpcMessage(error: { message?: string } | null): string {
  return error?.message ?? ''
}

/** 当該施設の最新の確定値。静的 JSON の値に上書きして表示する（SPEC §4.3） */
export function useLiveAmenities(facilityId: string) {
  return useQuery({
    queryKey: ['live-amenities', facilityId],
    enabled: supabase !== null,
    retry: 0,
    queryFn: async (): Promise<Record<string, AmenityValue>> => {
      const { data, error } = await supabase!
        .from('facility_amenities')
        .select('amenity_key, value, confidence, observed_at, evidence_count')
        .eq('facility_id', facilityId)
      if (error) throw error
      return Object.fromEntries((data as LiveAmenity[]).map(({ amenity_key, ...v }) => [amenity_key, v]))
    },
  })
}

export function useFacilityHistory(facilityId: string) {
  return useQuery({
    queryKey: ['history', facilityId],
    enabled: supabase !== null,
    retry: 0,
    queryFn: async () => {
      const [reports, disputes] = await Promise.all([
        supabase!.from('reports_public').select('*').eq('facility_id', facilityId).order('created_at', { ascending: false }).limit(200),
        supabase!.from('disputes_public').select('*').eq('facility_id', facilityId).order('created_at', { ascending: false }).limit(100),
      ])
      if (reports.error) throw reports.error
      if (disputes.error) throw disputes.error
      return { reports: reports.data as PublicReport[], disputes: disputes.data as PublicDispute[] }
    },
  })
}

export async function submitReport(input: {
  facilityId: string
  amenityKey: string
  value: AmenityJson
  basis: Basis
  observedAt: string
  sourceUrl: string | null
  photoUrls: string[] | null
  note: string | null
}): Promise<{ id: string; status: ReportStatus }> {
  const { data, error } = await supabase!.rpc('submit_report', {
    p_facility_id: input.facilityId,
    p_amenity_key: input.amenityKey,
    p_value: input.value,
    p_basis: input.basis,
    p_observed_at: input.observedAt,
    p_source_url: input.sourceUrl,
    p_photo_urls: input.photoUrls,
    p_note: input.note,
  })
  if (error) throw new Error(rpcMessage(error))
  return data as { id: string; status: ReportStatus }
}

export async function raiseDispute(input: {
  facilityId: string
  amenityKey: string
  reason: string
  counterValue: AmenityJson | null
  evidenceUrl: string | null
}): Promise<void> {
  const { error } = await supabase!.rpc('raise_dispute', {
    p_facility_id: input.facilityId,
    p_amenity_key: input.amenityKey,
    p_reason: input.reason,
    p_counter_value: input.counterValue,
    p_evidence_url: input.evidenceUrl,
  })
  if (error) throw new Error(rpcMessage(error))
}

/** 任意の関数を呼ぶ（モデレーション・申請・要請用） */
export async function callRpc(name: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await supabase!.rpc(name, args)
  if (error) throw new Error(rpcMessage(error))
}
