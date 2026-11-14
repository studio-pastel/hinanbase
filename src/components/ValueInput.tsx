import { ja } from '../i18n/ja.ts'
import { enumLabel, type AmenityDef } from '../lib/amenities.ts'
import type { AmenityJson } from '../lib/community.ts'

/** 設備項目の型（あり／なし・選択肢・整数）に応じた入力。項目の定義は amenity-defs.json から */
export function ValueInput({
  def, value, onChange, name, allowEmpty,
}: {
  def: AmenityDef
  value: AmenityJson | null
  onChange: (v: AmenityJson | null) => void
  name: string
  /** 「指定しない」を選べるようにする（異議の対立値用） */
  allowEmpty?: string
}) {
  if (def.value_type === 'integer') {
    return (
      <input
        type="number" inputMode="numeric" min={0} step={1} name={name}
        className="w-40 rounded border border-line bg-white px-2 py-1.5"
        value={value === null ? '' : String(value)}
        onChange={(e) => {
          const t = e.target.value.trim()
          onChange(/^\d{1,7}$/.test(t) ? Number(t) : null)
        }}
      />
    )
  }
  const options: { v: AmenityJson; label: string }[] =
    def.value_type === 'boolean'
      ? [{ v: true, label: ja.facility.yes }, { v: false, label: ja.facility.no }]
      : (def.enum_options ?? []).map((o) => ({ v: o, label: enumLabel(o) }))
  return (
    <div className="flex flex-wrap gap-2">
      {allowEmpty && (
        <label className="flex items-center gap-1.5 rounded border border-line bg-white px-3 py-1.5">
          <input type="radio" name={name} checked={value === null} onChange={() => onChange(null)} />
          {allowEmpty}
        </label>
      )}
      {options.map((o) => (
        <label key={String(o.v)} className="flex items-center gap-1.5 rounded border border-line bg-white px-3 py-1.5">
          <input type="radio" name={name} checked={value === o.v} onChange={() => onChange(o.v)} />
          {o.label}
        </label>
      ))}
    </div>
  )
}
