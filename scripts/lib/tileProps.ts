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
  HAZARD_KEYS.forEach((_, i) => { props[`h${i}`] = hz & (1 << i) ? 1 : 0 })
  DISPLAY_STATES.forEach((s, i) => { props[`s${i}`] = f.scores.display_state === s ? 1 : 0 })
  return props
}
