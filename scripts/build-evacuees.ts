// 都道府県の地震被害想定で公表されている市区町村別の避難者数（data/reference/evacuee-estimates.json）を検査し、
// 画面用に summary/evacuee-estimates.json として書き出す（DATA_NOTES 12.24）。本サービスの推定ではない。
//   npm run data:evacuees
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EvacueeEstimates, MuniIndexFile } from '../shared/types.ts'
import { BUILD_DIR, ROOT } from './lib/paths.ts'

const src = JSON.parse(readFileSync(join(ROOT, 'data', 'reference', 'evacuee-estimates.json'), 'utf8')) as EvacueeEstimates
const index = JSON.parse(readFileSync(join(BUILD_DIR, 'summary', 'munis.json'), 'utf8')) as MuniIndexFile
const known = new Set(index.prefs.flatMap((p) => p.munis.map((m) => m.key)))

const problems: string[] = []
for (const [code, p] of Object.entries(src.prefs)) {
  for (const [key, m] of Object.entries(p.munis)) {
    if (!key.startsWith(code)) problems.push(`${code}: ${m.name} のコード ${key} が都道府県と合わない`)
    if (!known.has(key)) problems.push(`${code}: ${m.name}（${key}）が施設データにない`)
    if (m.values.length !== p.columns.length) problems.push(`${code}: ${m.name} の値の数 ${m.values.length} が列の数 ${p.columns.length} と合わない`)
    // 欠損は null のまま。0 や推定値で埋めない（CLAUDE.md 絶対ルール 1）
    if (m.values.some((v) => v !== null && (!Number.isInteger(v) || v < 0))) problems.push(`${code}: ${m.name} に不正な値`)
  }
}
if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
writeFileSync(join(BUILD_DIR, 'summary', 'evacuee-estimates.json'), JSON.stringify(src))
const n = Object.values(src.prefs).reduce((s, p) => s + Object.keys(p.munis).length, 0)
console.log(`避難者数（公的な被害想定の引用）: ${Object.keys(src.prefs).length} 都道府県 / ${n} 市区町村`)
