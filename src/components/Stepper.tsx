import { ActionIcon, Input } from '@mantine/core'
import { IconMinus, IconPlus } from '@tabler/icons-react'
import { useEffect, useState } from 'react'

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

/** Thumb-sized − / + around a typeable value. Typing is free; the caller validates. */
export function Stepper({
  value, onChange, min, max, step = 1, unit, label, description, error, allowDecimal = true, size = 'md', 'aria-label': ariaLabel,
}: StepperProps) {
  const [text, setText] = useState(value == null ? '' : String(value))
  // Keep the text in sync with outside changes, but not while the typed text already means the same number.
  useEffect(() => {
    setText((t) => {
      const parsed = t.trim() === '' ? null : Number(t.replace(',', '.'))
      if (parsed === value) return t
      return value == null ? '' : String(value)
    })
  }, [value])

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  const commit = (n: number | null) => {
    setText(n == null ? '' : String(n))
    onChange(n)
  }
  const dec = () => commit(value == null || Number.isNaN(value) ? (min ?? 0) : clamp(round(value - step)))
  const inc = () => commit(value == null || Number.isNaN(value) ? clamp(min != null && min > 0 ? min : step) : clamp(round(value + step)))
  const atMin = min != null && value != null && value <= min
  const atMax = max != null && value != null && value >= max
  const px = size === 'lg' ? 52 : 44
  const name = ariaLabel ?? label ?? 'Value'

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
            className="sp-stepper-input"
            inputMode={allowDecimal ? 'decimal' : 'numeric'}
            enterKeyHint="done"
            autoComplete="off"
            aria-label={name}
            placeholder="–"
            aria-invalid={error ? true : undefined}
            value={text}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const raw = e.currentTarget.value
              if (!/^-?\d*[.,]?\d*$/.test(raw)) return
              if (!allowDecimal && /[.,]/.test(raw)) return
              setText(raw)
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
