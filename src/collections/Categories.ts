import type { CollectionConfig } from 'payload'

import { authenticated } from '../access/authenticated'
import { adminOnly } from '../access/adminOnly'

export const Categories: CollectionConfig = {
  slug: 'categories',
  access: {
    read: authenticated,
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name'],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
  ],
  timestamps: true,
}
