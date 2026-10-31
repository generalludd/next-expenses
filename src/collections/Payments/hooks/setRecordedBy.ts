import type { CollectionBeforeChangeHook } from 'payload'

import type { Payment } from '@/payload-types'

/** When paidOn is newly set and no recordedBy was supplied, stamp the logged-in user. */
export const setRecordedBy: CollectionBeforeChangeHook<Payment> = ({
  data,
  originalDoc,
  req,
}) => {
  const paidOnChanged = Boolean(data.paidOn) && data.paidOn !== originalDoc?.paidOn
  if (paidOnChanged && !data.recordedBy && req.user) {
    return { ...data, recordedBy: req.user.id }
  }
  return data
}
