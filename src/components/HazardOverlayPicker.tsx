import { ja } from '../i18n/ja.ts'
import { HAZARD_OVERLAYS, type HazardOverlay } from '../lib/map/index.ts'

/** 地図に重ねるハザードマップを選ぶ（SPEC §6.1）。ボタンを並べ、1 回のタップで切り替える */
export function HazardOverlayPicker({ value, onChange }: { value: HazardOverlay | null; onChange: (v: HazardOverlay | null) => void }) {
  const options: (HazardOverlay | null)[] = [null, ...HAZARD_OVERLAYS]
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-1 font-bold">{ja.overlay.label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o
          return (
            <button
              key={o ?? 'none'}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o)}
              className={
                on
                  ? 'min-h-9 rounded border-2 border-ink bg-ink px-3 text-sm font-bold text-white'
                  : 'min-h-9 rounded border-2 border-line bg-white px-3 text-sm'
              }
            >
              {o ? ja.overlay.names[o] : ja.overlay.none}
            </button>
          )
        })}
      </div>
      {value && (
        <p className="m-0 mt-1 text-sm text-ink-soft">
          {ja.overlay.note}{' '}
          <a href={ja.overlay.legendUrl} target="_blank" rel="noopener noreferrer">{ja.overlay.legendLink}</a>
          {' '}{ja.overlay.source}
        </p>
      )}
    </fieldset>
  )
}
