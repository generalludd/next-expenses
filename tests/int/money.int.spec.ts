import { describe, expect, it } from 'vitest'

import { balanceOf, formatMoney, fromCents, splitEvenly, toCents } from '@/lib/money'

describe('toCents / fromCents', () => {
  it('round-trips typical amounts', () => {
    expect(toCents('1663.61')).toBe(166361)
    expect(fromCents(166361)).toBe('1663.61')
    expect(toCents('260')).toBe(26000)
    expect(toCents('1017.8')).toBe(101780)
    expect(toCents('100.06')).toBe(10006)
  })

  it('pads single-digit cents', () => {
    expect(fromCents(100005)).toBe('1000.05')
  })

  it('handles negatives', () => {
    expect(fromCents(-166361)).toBe('-1663.61')
  })

  it('rejects non-numeric input', () => {
    expect(() => toCents('not a number')).toThrow()
  })
})

describe('formatMoney', () => {
  it('formats as USD', () => {
    expect(formatMoney(166361)).toBe('$1,663.61')
    expect(formatMoney(0)).toBe('$0.00')
  })
})

describe('splitEvenly', () => {
  it('sums back to the total for every count from 1 to 10', () => {
    const totals = [0, 1, 99, 100, 101, 10000, 33333, 123456]
    for (const total of totals) {
      for (let count = 1; count <= 10; count++) {
        const shares = splitEvenly(total, count)
        expect(shares).toHaveLength(count)
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total)
      }
    }
  })

  it('splits $100.00 across 3 people as 33.34 / 33.33 / 33.33', () => {
    expect(splitEvenly(10000, 3)).toEqual([3334, 3333, 3333])
  })

  it('rotation moves which index absorbs the leftover cent', () => {
    expect(splitEvenly(10000, 3, 0)).toEqual([3334, 3333, 3333])
    expect(splitEvenly(10000, 3, 1)).toEqual([3333, 3334, 3333])
    expect(splitEvenly(10000, 3, 2)).toEqual([3333, 3333, 3334])
    // Rotation wraps.
    expect(splitEvenly(10000, 3, 3)).toEqual(splitEvenly(10000, 3, 0))
  })

  it('negative rotation still lands in range', () => {
    expect(splitEvenly(10000, 3, -1)).toEqual(splitEvenly(10000, 3, 2))
  })

  it('handles an exact split with no remainder', () => {
    expect(splitEvenly(9900, 3)).toEqual([3300, 3300, 3300])
  })

  it('handles negative totals', () => {
    const shares = splitEvenly(-10000, 3)
    expect(shares.reduce((a, b) => a + b, 0)).toBe(-10000)
  })

  it('returns an empty array for a non-positive count', () => {
    expect(splitEvenly(10000, 0)).toEqual([])
    expect(splitEvenly(10000, -1)).toEqual([])
  })
})

describe('balanceOf', () => {
  it('is unpaid when paidCents is null', () => {
    expect(balanceOf(3333, null)).toEqual({ kind: 'unpaid', dueCents: 3333 })
  })

  it('is settled when paid matches due', () => {
    expect(balanceOf(3333, 3333)).toEqual({ kind: 'settled', dueCents: 3333, paidCents: 3333 })
  })

  it('is underpaid when paid is less than due', () => {
    expect(balanceOf(5000, 3333)).toEqual({
      kind: 'underpaid',
      dueCents: 5000,
      paidCents: 3333,
      deltaCents: 1667,
    })
  })

  it('is overpaid when paid is more than due', () => {
    expect(balanceOf(3333, 5000)).toEqual({
      kind: 'overpaid',
      dueCents: 3333,
      paidCents: 5000,
      deltaCents: 1667,
    })
  })
})
