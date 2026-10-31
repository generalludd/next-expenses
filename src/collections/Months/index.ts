import type { CollectionConfig } from 'payload'

import { authenticated } from '../../access/authenticated'
import { adminOnly } from '../../access/adminOnly'
import { normalizeStartsOn } from './normalizeStartsOn'

export const Months: CollectionConfig = {
  slug: 'months',
  access: {
    read: authenticated,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'startsOn',
    defaultColumns: ['startsOn'],
    description: 'Each row represents one calendar month that fees can be billed against.',
  },
  hooks: {
    beforeValidate: [normalizeStartsOn],
  },
  fields: [
    {
      name: 'startsOn',
      type: 'date',
      required: true,
      unique: true,
      index: true,
      admin: {
        date: {
          pickerAppearance: 'monthOnly',
          displayFormat: 'MMMM yyyy',
        },
        description: 'Normalized to the 1st of the month automatically.',
      },
    },
  ],
  timestamps: true,
}
