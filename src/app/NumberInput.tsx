import type { InputHTMLAttributes } from 'react'
import { numFromInput, numInputValue } from '../lib/format'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: number
  onChange: (n: number) => void
}

// Numeric input that can be emptied while typing (held as NaN) instead of
// snapping to 0. Leaving it empty fills in 0, or the field's min if it has one.
export function NumberInput({ value, onChange, onBlur, ...rest }: Props) {
  return (
    <input
      {...rest}
      type="number"
      value={numInputValue(value)}
      onChange={(e) => onChange(numFromInput(e.target.value))}
      onBlur={(e) => {
        if (!Number.isFinite(value)) onChange(rest.min != null ? Number(rest.min) : 0)
        onBlur?.(e)
      }}
    />
  )
}
