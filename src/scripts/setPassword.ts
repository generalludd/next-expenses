/**
 * Sets a user's password directly via the Local API, bypassing the
 * forgot-password/email flow entirely. Useful with no email adapter
 * configured — Payload's console fallback only logs
 * "Email attempted without being configured...", not the actual reset
 * link, so the normal admin-UI flow has nothing to recover.
 *
 * Usage: npx tsx src/scripts/setPassword.ts <email>
 * Prompts for the new password interactively (not passed as an argv
 * string, so it never ends up in shell history). The input is NOT masked —
 * it will echo to the terminal as you type. Fine for a one-off local admin
 * task; don't run this where someone's looking over your shoulder.
 */

import 'dotenv/config'
import { createInterface } from 'readline'
import { getPayload } from 'payload'

import config from '../payload.config'

/**
 * Asks both questions chained inside each other's callback, not via two
 * separate `await`ed `rl.question()` calls.
 *
 * With piped (non-TTY) stdin both lines of input are already buffered and
 * ready the moment the process starts. `readline` fires its 'line' events
 * as fast as the data allows it to, not paced to your `question()` calls.
 * An `await` between two sequential questions adds a microtask-queue hop —
 * just enough of a gap for the second line's 'line' event to fire (with no
 * listener yet attached, since that only happens after the first promise
 * resolves) and be silently dropped. The whole process then hangs forever
 * waiting on an answer that already came and went. Chaining synchronously
 * inside the first callback attaches the second listener before that event
 * fires, closing the gap.
 */
function promptPair(
  rl: ReturnType<typeof createInterface>,
  question1: string,
  question2: string,
): Promise<[string, string]> {
  return new Promise((resolve) => {
    rl.question(question1, (answer1) => {
      rl.question(question2, (answer2) => {
        resolve([answer1, answer2])
      })
    })
  })
}

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx src/scripts/setPassword.ts <email>')
    process.exit(1)
  }

  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    depth: 0,
  })
  const user = docs[0]
  if (!user) {
    console.error(`No user found with email ${email}`)
    process.exit(1)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const [password, confirm] = await promptPair(
    rl,
    `New password for ${email}: `,
    'Confirm: ',
  )
  rl.close()

  if (password !== confirm) {
    console.error('Passwords did not match. Nothing changed.')
    process.exit(1)
  }

  await payload.update({
    collection: 'users',
    id: user.id,
    data: { password },
  })

  console.log(`Password updated for ${email}.`)
  await payload.db.destroy?.()
  process.exit(0)
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})
