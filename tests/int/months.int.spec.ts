import { describe, expect, it } from 'vitest'

import {
  formatMonth,
  monthBounds,
  monthParts,
  monthStartFromParts,
  normalizeToMonthStart,
} from '@/lib/months'
import { isActiveForMonth } from '@/lib/activeUsers'

describe('normalizeToMonthStart', () => {
  it('pins any day in a month to UTC midnight on the 1st', () => {
    expect(normalizeToMonthStart('2026-10-15').toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(normalizeToMonthStart('2026-10-01').toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(normalizeToMonthStart('2026-10-31').toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('rejects an unparseable date', () => {
    expect(() => normalizeToMonthStart('not a date')).toThrow()
  })
})

describe('monthBounds', () => {
  it('a January month does not produce month 0', () => {
    // The legacy bug: decrementing from January could compute $prev_mo = 0.
    const { monthStart } = monthBounds('2026-01-15')
    expect(monthStart.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(monthStart.getUTCMonth()).toBe(0) // January, not -1 or 12
  })

  it('February ends on the 28th in a common year, not a literal 31', () => {
    // The legacy bug: a hardcoded "-31" day regardless of month length.
    const { monthEnd } = monthBounds('2026-02-01')
    expect(monthEnd.getUTCDate()).toBe(28)
  })

  it('February ends on the 29th in a leap year', () => {
    const { monthEnd } = monthBounds('2028-02-01')
    expect(monthEnd.getUTCDate()).toBe(29)
  })

  it('April ends on the 30th', () => {
    const { monthEnd } = monthBounds('2026-04-10')
    expect(monthEnd.getUTCDate()).toBe(30)
  })

  it('December does not roll into an invalid month 13', () => {
    const { monthStart, monthEnd } = monthBounds('2026-12-25')
    expect(monthStart.toISOString()).toBe('2026-12-01T00:00:00.000Z')
    expect(monthEnd.getUTCFullYear()).toBe(2026)
    expect(monthEnd.getUTCMonth()).toBe(11)
    expect(monthEnd.getUTCDate()).toBe(31)
  })
})

describe('monthParts / monthStartFromParts', () => {
  it('round-trips', () => {
    expect(monthParts('2026-10-15')).toEqual({ month: 10, year: 2026 })
    expect(monthStartFromParts(10, 2026).toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('rejects an out-of-range month', () => {
    expect(() => monthStartFromParts(0, 2026)).toThrow()
    expect(() => monthStartFromParts(13, 2026)).toThrow()
  })
})

describe('formatMonth', () => {
  it('renders "October 2026"', () => {
    expect(formatMonth('2026-10-15')).toBe('October 2026')
  })
})

describe('isActiveForMonth', () => {
  it('excludes a user who joins after the month ends', () => {
    expect(isActiveForMonth({ startDate: '2026-11-01', endDate: null }, '2026-10-15')).toBe(false)
  })

  it('includes a user who joins mid-month', () => {
    expect(isActiveForMonth({ startDate: '2026-10-15', endDate: null }, '2026-10-01')).toBe(true)
  })

  it('includes a user with no end date', () => {
    expect(isActiveForMonth({ startDate: '2020-01-01', endDate: null }, '2026-10-15')).toBe(true)
  })

  it('includes a user for the month they leave', () => {
    expect(isActiveForMonth({ startDate: '2020-01-01', endDate: '2026-10-15' }, '2026-10-01')).toBe(
      true,
    )
  })

  it('excludes a user for the month after they leave', () => {
    expect(isActiveForMonth({ startDate: '2020-01-01', endDate: '2026-10-15' }, '2026-11-01')).toBe(
      false,
    )
  })

  it('excludes a user with no startDate', () => {
    expect(isActiveForMonth({ startDate: null, endDate: null } as never, '2026-10-01')).toBe(false)
  })
})
