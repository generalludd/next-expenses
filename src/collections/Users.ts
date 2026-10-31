import type { CollectionConfig } from 'payload'

import { authenticated } from '../access/authenticated'
import { adminOnlyField } from '../access/adminOnly'

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    admin: authenticated,
    create: authenticated,
    delete: authenticated,
    read: authenticated,
    update: authenticated,
  },
  admin: {
    defaultColumns: ['name', 'email', 'roles', 'isActive'],
    useAsTitle: 'name',
  },
  auth: true,
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      options: ['admin', 'member'],
      defaultValue: ['member'],
      required: true,
      // Checked without a DB round trip in access functions.
      saveToJWT: true,
      access: {
        // Only admins may change who is an admin.
        update: adminOnlyField,
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'Login gate only. Does NOT affect who owes a share for a month — see startDate/endDate.',
      },
    },
    {
      name: 'startDate',
      type: 'date',
      required: true,
      admin: {
        date: { pickerAppearance: 'dayOnly' },
        description: 'Date this person joined the household. Fees for months before this are not split with them.',
      },
    },
    {
      name: 'endDate',
      type: 'date',
      admin: {
        date: { pickerAppearance: 'dayOnly' },
        description: 'Date this person left the household, if applicable. Leave blank while still a member.',
      },
    },
  ],
  timestamps: true,
}
