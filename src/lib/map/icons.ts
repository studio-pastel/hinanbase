// マーカーの画像をキャンバスで描く。色だけに頼らず、印の中に記号を入れる（SPEC §3.6）
import type { DisplayState } from '../../../shared/types.ts'

export const STATE_COLORS: Record<DisplayState, string> = {
  unknown: '#59626d',
  critical: '#a83232',
  poor: '#b5651d',
  fair: '#8a7500',
  good: '#2f7d4f',
}
export const STATE_SYMBOLS: Record<DisplayState, string> = {
  unknown: '?',
  critical: '!',
  poor: '▼',
  fair: '–',
  good: '✓',
}

/** 画像の解像度倍率。addImage の pixelRatio に渡す */
export const ICON_PIXEL_RATIO = 2
const RATIO = ICON_PIXEL_RATIO
const FONT = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'

export interface IconImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w * RATIO
  c.height = h * RATIO
  const ctx = c.getContext('2d')!
  ctx.scale(RATIO, RATIO)
  return { c, ctx }
}
function toImage(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D): IconImage {
  const d = ctx.getImageData(0, 0, c.width, c.height)
  return { width: c.width, height: c.height, data: d.data }
}

/** 施設1件の印。restrictedOnly は白抜き（受入対象者が限定された避難所） */
export function markerIcon(state: DisplayState, restrictedOnly: boolean): IconImage {
  const size = 30
  const { c, ctx } = canvas(size, size)
  const color = STATE_COLORS[state]
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  ctx.fillStyle = restrictedOnly ? '#ffffff' : color
  ctx.fill()
  ctx.lineWidth = restrictedOnly ? 2.5 : 1.5
  ctx.strokeStyle = restrictedOnly ? color : '#ffffff'
  ctx.stroke()
  ctx.fillStyle = restrictedOnly ? color : '#ffffff'
  ctx.font = `700 16px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(STATE_SYMBOLS[state], size / 2, size / 2 + 0.5)
  return toImage(c, ctx)
}

/** 選択中の施設を囲む輪 */
export function selectedIcon(): IconImage {
  const size = 42
  const { c, ctx } = canvas(size, size)
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2)
  ctx.lineWidth = 3
  ctx.strokeStyle = '#1f4e79'
  ctx.stroke()
  return toImage(c, ctx)
}

/** 「住所から探す」で選んだ地点の印。施設の印と見分けられるよう、塗りつぶした濃い丸に白い縁 */
export function pinIcon(): IconImage {
  const size = 34
  const { c, ctx } = canvas(size, size)
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2)
  ctx.fillStyle = '#1a1a1a'
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, 4, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  return toImage(c, ctx)
}

/** まとめ表示の印。label は件数（空文字のときは件数なし） */
export function clusterIcon(label: string): IconImage {
  const h = 34
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = `700 14px ${FONT}`
  const w = Math.max(h, Math.ceil(probe.measureText(label).width) + 20)
  const { c, ctx } = canvas(w, h)
  ctx.beginPath()
  ctx.roundRect(1.5, 1.5, w - 3, h - 3, (h - 3) / 2)
  ctx.fillStyle = STATE_COLORS.unknown
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 14px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label === '' ? '…' : label, w / 2, h / 2 + 0.5)
  return toImage(c, ctx)
}
