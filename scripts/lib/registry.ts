import type { Cluster } from './merge.ts'

/** 共通ID → facility_id の対応表の1行（DATA_NOTES D-3）。Git 管理する */
export interface RegistryEntry {
  source_id: string
  facility_id: string
  /** この共通ID を最初に見た取得日 */
  first_seen: string
  /** この共通ID を最後に見た取得日 */
  last_seen: string
}

export const REGISTRY_HEADER = 'source_id,facility_id,first_seen,last_seen'

export function parseRegistry(text: string): RegistryEntry[] {
  const lines = text.split(/\r?\n/).filter((l) => l !== '')
  if (lines.length === 0) return []
  if (lines[0] !== REGISTRY_HEADER) throw new Error('対応表のヘッダーが想定と違います')
  return lines.slice(1).map((l) => {
    const [source_id, facility_id, first_seen, last_seen] = l.split(',')
    if (!source_id || !facility_id || !first_seen || !last_seen) throw new Error(`対応表の行が壊れています: ${l}`)
    return { source_id, facility_id, first_seen, last_seen }
  })
}

export function formatRegistry(entries: RegistryEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.source_id < b.source_id ? -1 : 1))
  return (
    [REGISTRY_HEADER, ...sorted.map((e) => `${e.source_id},${e.facility_id},${e.first_seen},${e.last_seen}`)].join('\n') +
    '\n'
  )
}

export interface AssignResult {
  /** clusters と同じ順の facility_id */
  ids: string[]
  registry: RegistryEntry[]
  /** 今回の取得分に1行も現れなかった facility_id（公的データから消えた施設） */
  deprecated: string[]
  /** 以前と違う facility_id に付け替わった共通ID（施設の統合・分割が変わったとき） */
  remapped: { source_id: string; from: string; to: string }[]
  minted: number
}

/**
 * 施設に facility_id を割り当てる。
 * - 対応表に載っている共通ID を含む施設は、その facility_id を引き継ぐ（再取り込みで ID が変わらない）。
 * - 載っていなければ代表の共通ID を facility_id として新規採番する。
 * - 対応表の行は消さない。
 */
export function assignFacilityIds(clusters: Cluster[], previous: RegistryEntry[], snapshot: string): AssignResult {
  const prev = new Map(previous.map((e) => [e.source_id, e]))
  const usedIds = new Set(previous.map((e) => e.facility_id))
  const ids: (string | null)[] = clusters.map(() => null)
  const claimed = new Map<string, number>()

  // 1) 既存の ID を引き継ぐ。同じ ID を複数の施設が主張したら、その ID と同じ共通ID を持つ施設を優先する
  const wanted = clusters.map((c) => {
    const list: string[] = []
    for (const m of c.members) {
      const e = prev.get(m.sourceId)
      if (e && !list.includes(e.facility_id)) list.push(e.facility_id)
    }
    return list
  })
  const owns = (ci: number, fid: string) => clusters[ci]!.members.some((m) => m.sourceId === fid)
  clusters.forEach((_, ci) => {
    for (const fid of wanted[ci]!) {
      const holder = claimed.get(fid)
      if (holder === undefined) {
        claimed.set(fid, ci)
        ids[ci] = fid
        break
      }
      if (owns(ci, fid) && !owns(holder, fid)) {
        claimed.set(fid, ci)
        ids[ci] = fid
        ids[holder] = null
        break
      }
    }
  })
  // 2) 残りは新規採番。代表の共通ID が使用済みなら次の行の共通ID を使う
  let minted = 0
  clusters.forEach((c, ci) => {
    if (ids[ci] !== null) return
    const free = wanted[ci]!.find((fid) => !claimed.has(fid))
    const fid = free ?? c.members.map((m) => m.sourceId).find((id) => !claimed.has(id) && !usedIds.has(id))
    if (!fid) throw new Error(`facility_id を採番できません: ${c.members[0]!.sourceId}`)
    if (!free) minted++
    claimed.set(fid, ci)
    ids[ci] = fid
  })

  const next = new Map(prev)
  const remapped: AssignResult['remapped'] = []
  clusters.forEach((c, ci) => {
    const fid = ids[ci]!
    for (const m of c.members) {
      const e = prev.get(m.sourceId)
      if (e && e.facility_id !== fid) remapped.push({ source_id: m.sourceId, from: e.facility_id, to: fid })
      next.set(m.sourceId, {
        source_id: m.sourceId,
        facility_id: fid,
        first_seen: e?.first_seen ?? snapshot,
        last_seen: e && e.last_seen > snapshot ? e.last_seen : snapshot,
      })
    }
  })
  const registry = [...next.values()]
  const alive = new Set(ids as string[])
  const deprecated = [...new Set(registry.map((e) => e.facility_id))].filter((fid) => !alive.has(fid)).sort()
  return { ids: ids as string[], registry, deprecated, remapped, minted }
}
