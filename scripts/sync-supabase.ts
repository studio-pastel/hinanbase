// facility_index と amenity_defs を Supabase に同期する（SPEC §5.6）
// service role key は環境変数から読む。フロントのビルドには絶対に含めない。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import amenityDefs from '../config/amenity-defs.json' with { type: 'json' }
import type { MuniFile } from '../shared/types.ts'
import { BUILD_DIR } from './lib/paths.ts'

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('環境変数 VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
const supabase = createClient(url, key, { auth: { persistSession: false } })

const fail = (what: string, message: string): never => {
  throw new Error(`${what} に失敗しました: ${message}`)
}

// 1) 設備項目マスタ
{
  const rows = amenityDefs.amenities.map((a) => ({ key: a.key, value_type: a.value_type, enum_options: a.enum_options }))
  const { error } = await supabase.from('amenity_defs').upsert(rows, { onConflict: 'key' })
  if (error) fail('amenity_defs の同期', error.message)
  console.log(`amenity_defs: ${rows.length} 項目`)
}

// 2) 施設索引。市区町村 JSON から作る
const muniDir = join(BUILD_DIR, 'facilities', 'by-muni')
if (!existsSync(muniDir)) throw new Error('先に build-facilities を実行してください')
const current = new Map<string, { facility_id: string; muni_key: string; name: string; deprecated_at: null }>()
for (const file of readdirSync(muniDir)) {
  const muni = JSON.parse(readFileSync(join(muniDir, file), 'utf8')) as MuniFile
  for (const f of muni.facilities) {
    current.set(f.id, { facility_id: f.id, muni_key: muni.muni_key, name: f.name, deprecated_at: null })
  }
}

// 既存の索引を読み、変わった行だけ送る
const existing = new Map<string, { muni_key: string; name: string; deprecated_at: string | null }>()
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('facility_index')
    .select('facility_id, muni_key, name, deprecated_at')
    .order('facility_id')
    .range(from, from + 999)
  if (error) fail('facility_index の読み取り', error.message)
  for (const r of data!) existing.set(r.facility_id, r)
  if (data!.length < 1000) break
}

const changed = [...current.values()].filter((r) => {
  const e = existing.get(r.facility_id)
  return !e || e.muni_key !== r.muni_key || e.name !== r.name || e.deprecated_at !== null
})
for (let i = 0; i < changed.length; i += 1000) {
  const { error } = await supabase.from('facility_index').upsert(changed.slice(i, i + 1000), { onConflict: 'facility_id' })
  if (error) fail('facility_index の同期', error.message)
  if ((i / 1000) % 20 === 0) console.log(`  ${Math.min(i + 1000, changed.length)} / ${changed.length}`)
}

// 3) 公的データから消えた施設は削除せず deprecated_at を付ける（市民投稿を失わせない）
const gone = [...existing.entries()].filter(([id, e]) => !current.has(id) && e.deprecated_at === null).map(([id]) => id)
const now = new Date().toISOString()
for (let i = 0; i < gone.length; i += 200) {
  const { error } = await supabase.from('facility_index').update({ deprecated_at: now }).in('facility_id', gone.slice(i, i + 200))
  if (error) fail('deprecated_at の設定', error.message)
}

console.log(`facility_index: 現在 ${current.size} 件 / 追加・更新 ${changed.length} 件 / 廃止の印 ${gone.length} 件`)
