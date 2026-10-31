import type { CollectionBeforeValidateHook } from 'payload'

import { normalizeToMonthStart } from '@/lib/months'

/**
 * Pins `startsOn` to UTC midnight on the 1st of its month before validation,
 * so the unique index on `startsOn` can never admit two rows for the same
 * month. See src/lib/months.ts for why this has to happen in UTC specifically.
 */
export const normalizeStartsOn: CollectionBeforeValidateHook = ({ data }) => {
  if (!data?.startsOn) return data

  return {
    ...data,
    startsOn: normalizeToMonthStart(data.startsOn).toISOString(),
  }
}
