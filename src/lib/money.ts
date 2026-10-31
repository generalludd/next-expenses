/**
 * Money handling.
 *
 * Amounts are stored as integer cents in Payload `number` fields. A `number`
 * field becomes an unconstrained Postgres `numeric` read back through
 * `{ mode: 'number' }`, i.e. a JS float64 — integers below 2^53 survive that
 * exactly, decimal dollars do not. So all arithmetic happens in cents and we
 * convert only at the edges.
 *
 * Ported from /Users/chrisdart/Sites/exp.next.js/src/lib/money.ts.
 */

/** "1663.61" -> 166361 */
export function toCents(amount: string | number): number {
  const n = typeof amount === 'number' ? amount : Number.parseFloat(amount)
  if (!Number.isFinite(n)) throw new Error(`not a money value: ${String(amount)}`)
  return Math.round(n * 100)
}

/** 166361 -> "1663.61" */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(Math.round(cents))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** 166361 -> "$1,663.61" */
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

/**
 * Split a total evenly across `count` shares, in whole cents, so that the
 * shares always sum back to exactly the total.
 *
 * $100.00 across 3 people is 33.34 / 33.33 / 33.33 — not 33.33 three times,
 * which would silently lose a cent every month.
 *
 * Someone has to absorb the leftover cent, and if it were always index 0 the
 * same person would overpay on every odd-numbered fee forever. `rotation`
 * shifts which indices get it: pass the fee id and the burden moves around
 * deterministically, so it evens out over a year without ever being random.
 */
export function splitEvenly(totalCents: number, count: number, rotation = 0): number[] {
  if (count <= 0) return []
  const base = Math.trunc(totalCents / count)
  const remainder = totalCents - base * count
  const extras = Math.abs(remainder)
  const step = remainder >= 0 ? 1 : -1
  // Normalise so a negative rotation still lands in range.
  const offset = ((rotation % count) + count) % count

  return Array.from({ length: count }, (_, i) => {
    // Does this index fall in the window of `extras` slots starting at `offset`?
    const distance = (i - offset + count) % count
    return distance < extras ? base + step : base
  })
}

/**
 * How a single user stands on one fee. `dueCents` is the current share;
 * `paidCents` is the frozen snapshot taken when they paid. The two diverge only
 * when a fee is edited after the fact.
 */
export type PaymentBalance =
  | { kind: 'unpaid'; dueCents: number }
  | { kind: 'settled'; dueCents: number; paidCents: number }
  | { kind: 'underpaid'; dueCents: number; paidCents: number; deltaCents: number }
  | { kind: 'overpaid'; dueCents: number; paidCents: number; deltaCents: number }

export function balanceOf(dueCents: number, paidCents: number | null): PaymentBalance {
  if (paidCents === null) return { kind: 'unpaid', dueCents }
  const deltaCents = dueCents - paidCents
  if (deltaCents === 0) return { kind: 'settled', dueCents, paidCents }
  if (deltaCents > 0) return { kind: 'underpaid', dueCents, paidCents, deltaCents }
  return { kind: 'overpaid', dueCents, paidCents, deltaCents: -deltaCents }
}
