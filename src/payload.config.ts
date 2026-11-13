import { postgresAdapter } from '@payloadcms/db-postgres'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig, PayloadRequest } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { blockWhilePasswordChangePending, passwordChangePending } from './access/passwordChange'
import { Media } from './collections/Media'
import { Categories } from './collections/Categories'
import { Months } from './collections/Months'
import { Fees } from './collections/Fees'
import { Payments } from './collections/Payments'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  // Nobody with a pending password change gets access to anything (see passwordChange.ts).
  collections: [Users, Media, Categories, Months, Fees, Payments].map(
    blockWhilePasswordChangePending,
  ),
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
  }),
  cors: [process.env.NEXT_PUBLIC_SERVER_URL || ''].filter(Boolean),
  // Local dev: SMTP_HOST/PORT point at the Mailpit container (see
  // docker-compose.yml) so emails (e.g. password resets) can be read at
  // http://localhost:8027 without any real sending. Mailpit takes no auth,
  // so SMTP_USER/SMTP_PASS are only set in production.
  //
  // Production runs on a DigitalOcean droplet, which blocks outbound SMTP on
  // 25, 465 and 587 — use the provider's alternate port (usually 2525,
  // STARTTLS). `secure` (implicit TLS) is only for port 465.
  email: nodemailerAdapter({
    defaultFromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@expenses.local',
    defaultFromName: process.env.EMAIL_FROM_NAME || 'Expenses',
    transportOptions: {
      host: process.env.SMTP_HOST || '127.0.0.1',
      port: Number(process.env.SMTP_PORT) || 1026,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    },
  }),
  sharp,
  plugins: [],
  jobs: {
    access: {
      run: ({ req }: { req: PayloadRequest }): boolean => {
        // Logged-in users may run jobs, unless they still have to change their password.
        if (req.user) return !passwordChangePending(req.user)

        // Otherwise require the cron secret as a bearer token.
        const secret = process.env.CRON_SECRET
        if (!secret) return false

        return req.headers.get('authorization') === `Bearer ${secret}`
      },
    },
    tasks: [],
  },
})
