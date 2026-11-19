import type { DisplayState } from '../../shared/types.ts'
import { ja } from '../i18n/ja.ts'
import { STATE_COLORS, STATE_SYMBOLS } from '../lib/map/icons.ts'

/** 表示状態の印。色と記号の両方で示す（SPEC §3.6） */
/** 「想定区域と重なる（要確認）」の印。地図の三角の印と同じ形 */
export function AttentionMark() {
  return (
    <span aria-hidden="true" className="relative inline-block h-5 w-[22px] shrink-0">
      <svg viewBox="0 0 22 20" className="h-5 w-[22px]">
        <path d="M11 1 L21 19 L1 19 Z" fill="#1a1a1a" stroke="#fff" strokeWidth="1.5" />
        <text x="11" y="16.5" textAnchor="middle" fontSize="12" fontWeight="800" fill="#fff">!</text>
      </svg>
    </span>
  )
}

export function StateMark({ state, restrictedOnly = false }: { state: DisplayState; restrictedOnly?: boolean }) {
  const color = STATE_COLORS[state]
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[14px] font-bold leading-none"
      style={
        restrictedOnly
          ? { background: '#fff', color, border: `2px solid ${color}` }
          : { background: color, color: '#fff' }
      }
    >
      {STATE_SYMBOLS[state]}
    </span>
  )
}

export function StateLabel({ state, restrictedOnly = false }: { state: DisplayState; restrictedOnly?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <StateMark state={state} restrictedOnly={restrictedOnly} />
      <span>{ja.state.names[state]}</span>
    </span>
  )
}
