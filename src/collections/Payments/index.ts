import type { CollectionConfig } from 'payload'

import { authenticated } from '../../access/authenticated'
import { adminOnly, adminOnlyField, adminOrOwn } from '../../access/adminOnly'
import { setRecordedBy } from './hooks/setRecordedBy'

export const Payments: CollectionConfig = {
  slug: 'payments',
  access: {
    read: authenticated,
    // Normal creation happens only through Fees' fan-out hook, which uses the
    // Local API with default overrideAccess and so isn't subject to this.
    // Direct creation is an admin escape hatch for corrections.
    create: adminOnly,
    // Members can mark their own payments paid/unpaid; admins anyone's. The
    // fee/user/share fields are admin-only below, so on their own payments
    // members can only change paidOn.
    update: adminOrOwn('user'),
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['fee', 'user', 'shareCents', 'paidOn'],
  },
  hooks: {
    beforeChange: [setRecordedBy],
  },
  fields: [
    {
      name: 'fee',
      type: 'relationship',
      relationTo: 'fees',
      required: true,
      access: { update: adminOnlyField },
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: { update: adminOnlyField },
    },
    {
      name: 'shareCents',
      type: 'number',
      required: true,
      access: { update: adminOnlyField },
      admin: {
        description:
          'Frozen at creation. Changing the fee amount before anyone pays will re-split this; paying locks it in.',
      },
    },
    {
      name: 'paidOn',
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayOnly' },
        description: 'Blank means unpaid.',
      },
    },
    {
      name: 'recordedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        description: 'Who marked this paid. Set automatically.',
      },
    },
  ],
  indexes: [{ unique: true, fields: ['fee', 'user'] }],
  timestamps: true,
}
