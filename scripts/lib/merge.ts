import { coreName, distanceM, normalizeName } from './normalize.ts'
import type { SourceRow } from './source.ts'

/** 自動統合してよい距離の上限（m）。DATA_NOTES 7.3 */
export const MERGE_DISTANCE_M = 200

export interface Cluster {
  /** 代表の決め方（DATA_NOTES D-2）の順に並んだ行。先頭が代表 */
  members: SourceRow[]
  rules: string[]
}

export interface MergeCandidate {
  rule: 'R3' | 'R4' | 'R5'
  reason: string
  distance_m: number
  shelter: CandidateSide[]
  emergency: CandidateSide[]
}
interface CandidateSide {
  source_id: string
  name: string
  address: string
  lat: number
  lng: number
}

export interface MergeResult {
  clusters: Cluster[]
  candidates: MergeCandidate[]
}

/** 代表の優先順：避難所（区分1）＞避難所（区分2）＞緊急避難場所、枝番の小さい順 */
export function comparePriority(a: SourceRow, b: SourceRow): number {
  const rank = (r: SourceRow) => (r.kind === 'shelter' ? (r.klass === '1' ? 0 : 1) : 2)
  return rank(a) - rank(b) || a.branch - b.branch || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)
}

function minDistance(a: SourceRow[], b: SourceRow[]): number {
  let min = Infinity
  for (const x of a) for (const y of b) min = Math.min(min, distanceM(x, y))
  return min
}

const side = (r: SourceRow): CandidateSide => ({
  source_id: r.sourceId, name: r.name, address: r.address, lat: r.lat, lng: r.lng,
})

function contains(a: string, b: string): boolean {
  const ca = coreName(a)
  const cb = coreName(b)
  if (ca.length < 2 || cb.length < 2) return false
  return ca.includes(cb) || cb.includes(ca)
}

/**
 * 2ファイルの行を施設にまとめる（DATA_NOTES 7.3、D-4〜D-6）。
 * 統合は「共通ID の先頭 11 文字が同じ」行の中でだけ行う。
 */
export function mergeRows(rows: SourceRow[]): MergeResult {
  const byPrefix = new Map<string, SourceRow[]>()
  for (const r of rows) {
    const g = byPrefix.get(r.prefix)
    if (g) g.push(r)
    else byPrefix.set(r.prefix, [r])
  }

  const clusters: Cluster[] = []
  const candidates: MergeCandidate[] = []
  /** R5 用：自分の住所グループ内に同名の緊急避難場所がなかった避難所の名前グループ */
  const shelterUnmatched: SourceRow[][] = []

  for (const group of byPrefix.values()) {
    // 名前グループ（同じファイル・同じ正規化名）を作る
    type NameGroup = { kind: 'shelter' | 'emergency'; norm: string; rows: SourceRow[]; root: number }
    const nameGroups: NameGroup[] = []
    const find = (kind: string, norm: string) => nameGroups.find((n) => n.kind === kind && n.norm === norm)
    for (const r of group) {
      const norm = normalizeName(r.name)
      const ng = find(r.kind, norm)
      if (ng) ng.rows.push(r)
      else nameGroups.push({ kind: r.kind, norm, rows: [r], root: nameGroups.length })
    }
    const parent = nameGroups.map((_, i) => i)
    const rulesOf = nameGroups.map((n) => new Set<string>(n.rows.length > 1 ? ['SAME_NAME'] : []))
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)))
    const union = (i: number, j: number, rule: string) => {
      const a = root(i)
      const b = root(j)
      rulesOf[a]!.add(rule)
      if (a === b) return
      for (const x of rulesOf[b]!) rulesOf[a]!.add(x)
      parent[b] = a
    }

    const shelters = nameGroups.map((n, i) => ({ n, i })).filter((x) => x.n.kind === 'shelter')
    const emergencies = nameGroups.map((n, i) => ({ n, i })).filter((x) => x.n.kind === 'emergency')
    for (const s of shelters) {
      let exact = false
      for (const e of emergencies) {
        const sameName = s.n.norm === e.n.norm
        if (!sameName && !contains(s.n.norm, e.n.norm)) continue
        if (sameName) exact = true
        const d = minDistance(s.n.rows, e.n.rows)
        if (d < MERGE_DISTANCE_M) {
          union(s.i, e.i, sameName ? 'R1' : 'R2')
        } else {
          candidates.push({
            rule: sameName ? 'R3' : 'R4',
            reason: sameName
              ? '同じ住所グループで施設名が一致するが、座標が 200m 以上離れている'
              : '同じ住所グループで施設名が包含関係にあるが、座標が 200m 以上離れている',
            distance_m: Math.round(d),
            shelter: s.n.rows.map(side),
            emergency: e.n.rows.map(side),
          })
        }
      }
      if (!exact) shelterUnmatched.push(s.n.rows)
    }

    const merged = new Map<number, Cluster>()
    nameGroups.forEach((n, i) => {
      const r = root(i)
      const c = merged.get(r) ?? { members: [], rules: [] }
      c.members.push(...n.rows)
      merged.set(r, c)
    })
    for (const [r, c] of merged) {
      c.members.sort(comparePriority)
      c.rules = [...rulesOf[r]!].sort()
      clusters.push(c)
    }
  }

  // R5：住所グループは違うが、同じ市区町村で施設名が一致する（統合はせず候補に出す）
  const emergencyByName = new Map<string, SourceRow[]>()
  for (const r of rows) {
    if (r.kind !== 'emergency') continue
    const key = `${r.muniKey}\t${normalizeName(r.name)}`
    const list = emergencyByName.get(key)
    if (list) list.push(r)
    else emergencyByName.set(key, [r])
  }
  for (const sRows of shelterUnmatched) {
    const first = sRows[0]!
    const hits = (emergencyByName.get(`${first.muniKey}\t${normalizeName(first.name)}`) ?? []).filter(
      (e) => e.prefix !== first.prefix,
    )
    if (hits.length === 0) continue
    candidates.push({
      rule: 'R5',
      reason: '共通ID の住所グループは違うが、同じ市区町村で施設名が一致する',
      distance_m: Math.round(minDistance(sRows, hits)),
      shelter: sRows.map(side),
      emergency: hits.map(side),
    })
  }

  clusters.sort((a, b) => (a.members[0]!.sourceId < b.members[0]!.sourceId ? -1 : 1))
  candidates.sort(
    (a, b) => a.rule.localeCompare(b.rule) || a.shelter[0]!.source_id.localeCompare(b.shelter[0]!.source_id),
  )
  return { clusters, candidates }
}
