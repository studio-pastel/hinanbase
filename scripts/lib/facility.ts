import { prefName } from '../../shared/prefs.ts'
import {
  HAZARD_KEYS, KIND_EMERGENCY, KIND_SHELTER,
  type EmergencyDesignation, type Facility, type Scores, type ShelterDesignation,
} from '../../shared/types.ts'
import type { Cluster } from './merge.ts'
import { cleanText, nullIfEmpty } from './normalize.ts'
import type { SourceRow } from './source.ts'

export const SCORE_METHOD_VERSION = 'phase1-0'

/** 受入対象者を限定した避難所か（DATA_NOTES D-11） */
export function isRestricted(r: SourceRow): boolean {
  return r.kind === 'shelter' && (r.klass === '2' || r.target.trim() !== '')
}

/**
 * Phase 1 のスコア。設備データがまだ1件もないので、4軸すべて未評価（null）。
 * 0 や平均値では埋めない（CLAUDE.md 絶対ルール 1・2）。
 */
export function phase1Scores(): Scores {
  return {
    hazard: null,
    capacity: null,
    habitability: null,
    logistics: null,
    coverage_ratio: 0,
    display_state: 'unknown',
    breakdown: {
      method_version: SCORE_METHOD_VERSION,
      hazard: { status: 'not_evaluated', reason: 'ハザードデータ未取り込み（Phase 4）' },
      capacity: { status: 'not_evaluated', reason: '収容データ未取り込み（Phase 4）' },
      habitability: { status: 'not_evaluated', reason: '設備情報なし（Phase 3）' },
      logistics: { status: 'not_evaluated', reason: '道路データ未取り込み（Phase 4）' },
      coverage: { answered_weight: 0, note: '回答済みの設備項目なし' },
    },
  }
}

export function buildFacility(id: string, cluster: Cluster): Facility {
  const rep = cluster.members[0]!
  const emergency_site: EmergencyDesignation[] = []
  const shelter: ShelterDesignation[] = []
  for (const m of cluster.members) {
    if (m.kind === 'emergency') {
      emergency_site.push({
        source_id: m.sourceId, name: cleanText(m.name), hazards: m.hazards!, note: nullIfEmpty(m.note),
        lat: m.lat, lng: m.lng,
      })
    } else {
      shelter.push({
        source_id: m.sourceId, name: cleanText(m.name), restricted: isRestricted(m),
        target: nullIfEmpty(m.target), other: nullIfEmpty(m.other), note: nullIfEmpty(m.note),
        lat: m.lat, lng: m.lng,
      })
    }
  }
  return {
    id,
    name: cleanText(rep.name),
    address: cleanText(rep.address),
    // 座標は代表（避難所を優先）の値。各指定の元の座標は designations に残す（DATA_NOTES D-5）
    lat: rep.lat,
    lng: rep.lng,
    designations: { emergency_site, shelter },
    merge_rules: cluster.rules,
    amenities: {},
    scores: phase1Scores(),
  }
}

export function kindFlags(f: Facility): number {
  return (f.designations.emergency_site.length > 0 ? KIND_EMERGENCY : 0) | (f.designations.shelter.length > 0 ? KIND_SHELTER : 0)
}

/** 災害種別のビットマスク。施設内の緊急避難場所の全行の和集合（DATA_NOTES D-12） */
export function hazardMask(f: Facility): number {
  let mask = 0
  for (const d of f.designations.emergency_site) {
    HAZARD_KEYS.forEach((k, i) => { if (d.hazards[k]) mask |= 1 << i })
  }
  return mask
}

/** 避難所の指定があり、そのすべてが受入対象者限定 */
export function isRestrictedOnly(f: Facility): boolean {
  const s = f.designations.shelter
  return s.length > 0 && s.every((d) => d.restricted)
}

/** 「北海道札幌市」→ 都道府県名と市区町村名に分ける */
export function splitMuniLabel(muniKey: string, label: string): { prefCode: string; prefName: string; muniName: string } {
  const prefCode = muniKey.slice(0, 2)
  const pref = prefName(prefCode)
  if (!pref || !label.startsWith(pref)) throw new Error(`市区町村コードと名称が合いません: ${muniKey} ${label}`)
  return { prefCode, prefName: pref, muniName: label.slice(pref.length) }
}
