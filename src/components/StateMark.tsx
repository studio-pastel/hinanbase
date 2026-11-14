import type { DisplayState } from '../../shared/types.ts'
import { ja } from '../i18n/ja.ts'
import { STATE_COLORS, STATE_SYMBOLS } from '../lib/map/icons.ts'

/** 表示状態の印。色と記号の両方で示す（SPEC §3.6） */
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
