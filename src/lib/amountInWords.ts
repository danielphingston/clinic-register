const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(' ')
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100)
  return [h ? `${ONES[h]} Hundred` : '', belowHundred(n % 100)].filter(Boolean).join(' ')
}

// Indian grouping: crore (10^7), lakh (10^5), thousand, hundred. Amounts of
// 100 crore or more repeat the scale: "One Hundred Crore".
export function numberInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('Expected a non-negative integer')
  if (n === 0) return 'Zero'
  const crore = Math.floor(n / 10_000_000)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1000)
  const rest = n % 1000
  return [
    crore ? `${numberInWords(crore)} Crore` : '',
    lakh ? `${belowHundred(lakh)} Lakh` : '',
    thousand ? `${belowHundred(thousand)} Thousand` : '',
    belowThousand(rest),
  ]
    .filter(Boolean)
    .join(' ')
}

// 1250 -> "Rupees One Thousand Two Hundred Fifty Only"
// 10.5 -> "Rupees Ten and Fifty Paise Only" (paise are rounded to 2 places)
export function amountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Expected a non-negative amount')
  const totalPaise = Math.round(amount * 100)
  const rupees = Math.floor(totalPaise / 100)
  const paise = totalPaise % 100
  const paiseText = paise ? ` and ${numberInWords(paise)} Paise` : ''
  return `Rupees ${numberInWords(rupees)}${paiseText} Only`
}
