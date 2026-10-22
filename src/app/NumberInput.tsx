import { useRef, type InputHTMLAttributes } from 'react'
import { numFromInput, numInputValue } from '../lib/format'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: number
  onChange: (n: number) => void
}

// Numeric input that can be emptied while typing (held as NaN) instead of
// snapping to 0. Leaving it empty puts back the value it had on focus.
export function NumberInput({ value, onChange, onFocus, onBlur, ...rest }: Props) {
  const before = useRef(value)
  return (
    <input
      {...rest}
      type="number"
      value={numInputValue(value)}
      onFocus={(e) => {
        before.current = value
        onFocus?.(e)
      }}
      onChange={(e) => onChange(numFromInput(e.target.value))}
      onBlur={(e) => {
        if (!Number.isFinite(value)) onChange(before.current)
        onBlur?.(e)
      }}
    />
  )
}
