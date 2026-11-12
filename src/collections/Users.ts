import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import { authenticated } from '../access/authenticated'
import { adminOnly, adminOnlyField, adminOrOwn, isAdmin } from '../access/adminOnly'

export const Users: CollectionConfig = {
  slug: 'users',
  // Admins manage everyone; members can only edit their own name, email and
  // password (the membership fields below are admin-only at field level).
  access: {
    // Who can open /admin at all.
    admin: ({ req: { user } }) => isAdmin(user),
    create: adminOnly,
    delete: adminOnly,
    read: authenticated,
    update: adminOrOwn('id'),
  },
  hooks: {
    // Enforces isActive as the login gate it's documented to be. Runs after
    // the password check, for both /login and /admin login.
    beforeLogin: [
      ({ user }) => {
        if (user.isActive === false) {
          throw new APIError('This account has been disabled.', 401)
        }
      },
    ],
  },
  admin: {
    defaultColumns: ['name', 'email', 'roles', 'isActive'],
    useAsTitle: 'name',
  },
  auth: {
    forgotPassword: {
      // Point the emailed link at the frontend reset page rather than
      // Payload's default /admin/reset/<token>.
      generateEmailSubject: () => 'Reset your Expenses password',
      generateEmailHTML: ({ token } = {}) => {
        const url = `${process.env.NEXT_PUBLIC_SERVER_URL || ''}/reset-password?token=${token}`
        return `<p>Someone asked to reset your Expenses password.</p>
<p><a href="${url}">${url}</a></p>
<p>This link expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`
      },
    },
  },
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
      access: { update: adminOnlyField },
      admin: {
        description:
          'Login gate only. Does NOT affect who owes a share for a month — see startDate/endDate.',
      },
    },
    {
      name: 'startDate',
      type: 'date',
      required: true,
      access: { update: adminOnlyField },
      admin: {
        date: { pickerAppearance: 'dayOnly' },
        description:
          'Date this person joined the household. Fees for months before this are not split with them.',
      },
    },
    {
      name: 'endDate',
      type: 'date',
      access: { update: adminOnlyField },
      admin: {
        date: { pickerAppearance: 'dayOnly' },
        description:
          'Date this person left the household, if applicable. Leave blank while still a member.',
      },
    },
  ],
  timestamps: true,
}
