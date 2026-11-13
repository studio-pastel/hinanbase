import type { SourceRow } from '../scripts/lib/source.ts'

const NO_HAZARDS = {
  flood: false, landslide: false, storm_surge: false, earthquake: false,
  tsunami: false, fire: false, inland_flood: false, volcano: false,
}

/** テスト用の行を作る。id は共通ID（14 文字） */
export function row(id: string, name: string, over: Partial<SourceRow> = {}): SourceRow {
  const kind = id[11] === '1' ? 'shelter' : 'emergency'
  return {
    sourceId: id, kind, prefix: id.slice(0, 11), muniKey: id.slice(1, 6), muniLabel: '北海道札幌市',
    klass: id[12]!, branch: parseInt(id[13]!, 36), name, address: '北海道札幌市中央区1-1',
    lat: 43.0, lng: 141.0, note: '', target: '', other: '',
    hazards: kind === 'emergency' ? { ...NO_HAZARDS, earthquake: true } : null,
    ...over,
  }
}
/** 緯度をおよそ m メートル分ずらす */
export const north = (m: number) => ({ lat: 43.0 + m / 111_320 })
