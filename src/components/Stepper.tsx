import { ActionIcon, Input, InputWrapperContext } from '@mantine/core'
import { IconMinus, IconPlus } from '@tabler/icons-react'
import { useContext, useState } from 'react'

export interface StepperProps {
  value: number | null
  onChange: (v: number | null) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  label?: string
  description?: string
  error?: string
  allowDecimal?: boolean
  size?: 'md' | 'lg'
  'aria-label'?: string
}

const round = (n: number) => Math.round(n * 1000) / 1000
/** What a typed string means, without committing it: "" is empty, "1,5" is 1.5, "." is NaN like the caller's parse. */
const parse = (t: string) => (t.trim() === '' ? null : Number(t.replace(',', '.')))
/** NaN stands for "half-typed" and must not send the field back to the caller's value. */
const sameNumber = (a: number | null, b: number | null) => a === b || (Number.isNaN(a) && Number.isNaN(b))

/** Thumb-sized − / + around a typeable value. Typing is free; the caller validates. */
export function Stepper({
  value, onChange, min, max, step = 1, unit, label, description, error, allowDecimal = true, size = 'md', 'aria-label': ariaLabel,
}: StepperProps) {
  // The text stays exactly as typed while it means the caller's value; an outside change (a reset, a partner edit or
  // the −/+ buttons) replaces it. Derived during render, so there is no state-copying effect to race with typing.
  const [typed, setTyped] = useState<string | null>(null)
  const text = typed !== null && sameNumber(parse(typed), value) ? typed : value == null ? '' : String(value)

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  const commit = (n: number | null) => {
    setTyped(n == null ? '' : String(n))
    onChange(n)
  }
  const dec = () => commit(value == null || Number.isNaN(value) ? (min ?? 0) : clamp(round(value - step)))
  const inc = () => commit(value == null || Number.isNaN(value) ? clamp(min != null && min > 0 ? min : step) : clamp(round(value + step)))
  const atMin = min != null && value != null && value <= min
  const atMax = max != null && value != null && value >= max
  const px = size === 'lg' ? 52 : 44
  const name = ariaLabel ?? label ?? 'Value'
  // The raw input is not Mantine's InputBase, so it must take the wrapper's ids itself: without this the
  // description and error are only painted, never announced or linked (MR-045).
  const wrapper = useContext(InputWrapperContext)

  return (
    <Input.Wrapper label={label} description={description} error={error} style={{ width: '100%' }}>
      <div className="sp-stepper" data-size={size} data-error={error ? '' : undefined}>
        <ActionIcon
          variant="default" size={px} aria-label={`Decrease ${name}`}
          disabled={atMin}
          onClick={dec}
        >
          <IconMinus size={20} />
        </ActionIcon>
        <div className="sp-stepper-field" data-unit={unit ? '' : undefined}>
          <input
            id={wrapper.inputId}
            className="sp-stepper-input"
            inputMode={allowDecimal ? 'decimal' : 'numeric'}
            enterKeyHint="done"
            autoComplete="off"
            aria-label={name}
            aria-describedby={wrapper.describedBy}
            placeholder="–"
            aria-invalid={error ? true : undefined}
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const raw = e.currentTarget.value
              if (!/^-?\d*[.,]?\d*$/.test(raw)) return
              if (!allowDecimal && /[.,]/.test(raw)) return
              setTyped(raw)
              if (raw.trim() === '') return onChange(null)
              const n = Number(raw.replace(',', '.'))
              onChange(Number.isNaN(n) ? NaN : n)
            }}
          />
          {unit ? <span className="sp-stepper-unit">{unit}</span> : null}
        </div>
        <ActionIcon variant="default" size={px} aria-label={`Increase ${name}`} disabled={atMax} onClick={inc}>
          <IconPlus size={20} />
        </ActionIcon>
      </div>
    </Input.Wrapper>
  )
}
