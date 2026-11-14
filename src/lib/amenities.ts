// 設備項目は config/amenity-defs.json から構築する。画面側に設備名を直接書かない（CLAUDE.md 絶対ルール 4）
import defs from '../../config/amenity-defs.json'
import { ja } from '../i18n/ja.ts'

export interface AmenityDef {
  key: string
  label_ja: string
  category: string
  value_type: string
  enum_options: string[] | null
  weight: number
  help_text: string
  /** 現地で目視確認しやすい順（小さいほど先）。投稿フォームの並び順に使う */
  onsite_rank: number
  habitability: unknown
  habitability_excluded_reason?: string
}

export const amenityCategories: { key: string; label_ja: string; items: AmenityDef[] }[] = defs.categories.map((c) => ({
  ...c,
  items: (defs.amenities as AmenityDef[]).filter((a) => a.category === c.key),
}))

const enumLabels: Record<string, string> = defs.enum_labels_ja

/** 投稿フォームの順：現地で目視確認しやすい項目から（SPEC §6.4） */
export const amenitiesByOnsiteRank: AmenityDef[] = [...(defs.amenities as AmenityDef[])].sort(
  (a, b) => a.onsite_rank - b.onsite_rank,
)
export const amenityByKey = new Map((defs.amenities as AmenityDef[]).map((a) => [a.key, a]))
export const enumLabel = (v: string) => enumLabels[v] ?? v

/** 値そのものの表示（信頼度に関係なく） */
export function formatValue(def: AmenityDef | undefined, value: string | number | boolean | null): string {
  if (value === null || !def) return ja.facility.unknownValue
  if (def.value_type === 'boolean') return value ? ja.facility.yes : ja.facility.no
  if (def.value_type === 'enum') return enumLabel(String(value))
  return String(value)
}
