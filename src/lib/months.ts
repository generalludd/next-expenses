/**
 * Month arithmetic, in UTC.
 *
 * A Payload `date` field is a Postgres `timestamp(3) with time zone`, not a
 * `date`. So "October 2026" is only a single value if we pin it to a specific
 * instant — UTC midnight on the 1st. Normalising in local time would put a
 * user in a negative-offset timezone into the previous month.
 *
 * The legacy CodeIgniter equivalent (User_model::count_active) had two bugs
 * this replaces: it could compute month 0 when decrementing from January, and
 * it built a literal day "-31" regardless of how long the month actually is.
 * Date.UTC handles both — it normalises overflow, so month 12 rolls into
 * January of the next year, and day 0 of month n+1 is the last day of month n.
 */

/** Any date -> UTC midnight on the 1st of its month. */
export function normalizeToMonthStart(input: Date | string): Date {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) throw new Error(`not a date: ${String(input)}`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0))
}

/** The half-open-ish bounds of the month containing `input`, inclusive of both ends. */
export function monthBounds(input: Date | string): { monthStart: Date; monthEnd: Date } {
  const monthStart = normalizeToMonthStart(input)
  const monthEnd = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  )
  return { monthStart, monthEnd }
}

/** 1-based month and full year, e.g. { month: 10, year: 2026 }. */
export function monthParts(input: Date | string): { month: number; year: number } {
  const d = normalizeToMonthStart(input)
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }
}

/** Build a month start from a 1-based month number and year. */
export function monthStartFromParts(month: number, year: number): Date {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`month out of range: ${month}`)
  }
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
}

/** "October 2026" */
export function formatMonth(input: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(normalizeToMonthStart(input))
}

/** { month: 1, year: 2026 } -> { month: 12, year: 2025 }. Date.UTC normalises the month-0 rollunder. */
export function previousMonth(month: number, year: number): { month: number; year: number } {
  const d = new Date(Date.UTC(year, month - 1 - 1, 1))
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }
}

/** { month: 12, year: 2025 } -> { month: 1, year: 2026 }. Date.UTC normalises the month-13 rollover. */
export function nextMonth(month: number, year: number): { month: number; year: number } {
  const d = new Date(Date.UTC(year, month - 1 + 1, 1))
  return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }
}
