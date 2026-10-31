import type { CollectionConfig } from 'payload'

import { authenticated } from '../../access/authenticated'
import { cascadeDeletePayments } from './hooks/cascadeDeletePayments'
import { fanOutPayments } from './hooks/fanOutPayments'
import { guardAmountEdit } from './hooks/guardAmountEdit'
import { setCreatedBy } from './hooks/setCreatedBy'

export const Fees: CollectionConfig = {
  slug: 'fees',
  access: {
    read: authenticated,
    create: authenticated,
    update: authenticated,
    delete: authenticated,
  },
  admin: {
    useAsTitle: 'category',
    defaultColumns: ['category', 'month', 'amountCents', 'createdBy', 'createdAt'],
  },
  hooks: {
    beforeChange: [setCreatedBy, guardAmountEdit],
    afterChange: [fanOutPayments],
    beforeDelete: [cascadeDeletePayments],
  },
  fields: [
    {
      name: 'month',
      type: 'relationship',
      relationTo: 'months',
      required: true,
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
    },
    {
      name: 'amountCents',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Whole cents, e.g. 10000 for $100.00. Stored as an integer to avoid float rounding drift.',
      },
    },
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'payments',
      type: 'join',
      collection: 'payments',
      on: 'fee',
      admin: {
        defaultColumns: ['user', 'shareCents', 'paidOn'],
      },
    },
  ],
  timestamps: true,
}
