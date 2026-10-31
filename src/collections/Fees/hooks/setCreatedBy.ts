import type { CollectionBeforeChangeHook } from 'payload'

import type { Fee } from '@/payload-types'

/** Stamps the logged-in user as the creator. The field is admin-readOnly so this is the only way it's set. */
export const setCreatedBy: CollectionBeforeChangeHook<Fee> = ({ data, operation, req }) => {
  if (operation !== 'create') return data
  if (data.createdBy) return data // migration script sets this explicitly
  if (!req.user) return data

  return { ...data, createdBy: req.user.id }
}
