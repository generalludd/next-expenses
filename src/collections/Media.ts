import type { CollectionConfig } from 'payload'

import { authenticated } from '../access/authenticated'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    create: authenticated,
    delete: authenticated,
    read: authenticated,
    update: authenticated,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
    },
  ],
  upload: true,
}
