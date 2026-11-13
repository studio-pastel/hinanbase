// 設備項目は config/amenity-defs.json から構築する。画面側に設備名を直接書かない（CLAUDE.md 絶対ルール 4）
import defs from '../../config/amenity-defs.json'
import type { AmenityValue } from '../../shared/types.ts'
import { ja } from '../i18n/ja.ts'

export interface AmenityDef {
  key: string
  label_ja: string
  category: string
  value_type: string
  enum_options: string[] | null
  weight: number
  help_text: string
}

export const amenityCategories: { key: string; label_ja: string; items: AmenityDef[] }[] = defs.categories.map((c) => ({
  ...c,
  items: (defs.amenities as AmenityDef[]).filter((a) => a.category === c.key),
}))

const enumLabels: Record<string, string> = defs.enum_labels_ja

/** 値がなければ「未確認」。推定値では埋めない */
export function formatAmenity(def: AmenityDef, v: AmenityValue | undefined): string {
  if (!v || v.confidence === 'disputed') return ja.facility.unknownValue
  if (def.value_type === 'boolean') return v.value ? ja.facility.yes : ja.facility.no
  if (def.value_type === 'enum') return enumLabels[String(v.value)] ?? String(v.value)
  return String(v.value)
}
