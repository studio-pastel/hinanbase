import { DISPLAY_STATES, HAZARD_KEYS, type Facility } from '../../shared/types.ts'
import { hazardMask, isRestrictedOnly, kindFlags } from './facility.ts'

/** 低ズームのまとめ表示で合算する属性（各施設は 0 か 1 を持つ） */
export const SUM_ATTRIBUTES = [
  'ne', 'ns', ...HAZARD_KEYS.map((_, i) => `h${i}`),
  // 表示状態ごとの件数（unknown / critical / poor / fair / good の順）
  ...DISPLAY_STATES.map((_, i) => `s${i}`),
  // 冷房なし（aircon_main_hall が none で確定）の件数
  'acn',
  // 指定された災害種別が想定区域と重なる（要確認の種別がある）件数
  'hm',
]

/** 冷房の確定値。未確認・争点中なら undefined（タイルの属性自体を持たせない） */
export function confirmedAircon(f: Facility): string | undefined {
  const v = f.amenities.aircon_main_hall
  return v && v.confidence !== 'disputed' && typeof v.value === 'string' ? v.value : undefined
}

/** タイルの属性（SPEC §2.4） */
export function tileProps(f: Facility, muniKey: string): Record<string, string | number> {
  const kind = kindFlags(f)
  const hz = hazardMask(f)
  const ac = confirmedAircon(f)
  const props: Record<string, string | number> = {
    id: f.id, name: f.name, muni: muniKey, kind, hz, state: f.scores.display_state,
    rs: isRestrictedOnly(f) ? 1 : 0,
    ne: kind & 1 ? 1 : 0, ns: kind & 2 ? 1 : 0,
    acn: ac === 'none' ? 1 : 0,
    hm: f.scores.hazard_check.status === 'attention' ? 1 : 0,
  }
  if (ac !== undefined) props.ac = ac
  // 色分けの指標（DATA_NOTES 14.5）。分からないものは属性自体を持たせない（未確認）
  const d = f.depth
  if (d?.flood !== undefined) props.fd = d.flood
  if (d?.tsunami !== undefined) props.td = d.tsunami
  if (d?.storm_surge !== undefined) props.sd = d.storm_surge
  if (d?.landslide !== undefined) props.ls = d.landslide
  const rd = roadBand(f.road?.distance_m)
  if (rd !== undefined) props.rd = rd
  HAZARD_KEYS.forEach((_, i) => { props[`h${i}`] = hz & (1 << i) ? 1 : 0 })
  DISPLAY_STATES.forEach((s, i) => { props[`s${i}`] = f.scores.display_state === s ? 1 : 0 })
  return props
}

/** 緊急輸送道路までの距離の区分：0=500m 未満 1=2km 未満 2=5km 未満 3=5km 以上（軸D と同じ区切り） */
export function roadBand(m: number | null | undefined): number | undefined {
  if (m === null || m === undefined) return undefined
  return m < 500 ? 0 : m < 2000 ? 1 : m < 5000 ? 2 : 3
}
