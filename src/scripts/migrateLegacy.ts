/**
 * One-time migration from the legacy CodeIgniter MySQL dump into this
 * Payload backend.
 *
 * Usage: npx tsx src/scripts/migrateLegacy.ts [path-to-dump.sql]
 * Defaults to the known location of the dump on this machine.
 *
 * Source: legacy `user` (2 rows), `fee` (429 rows), `payment` (730 rows,
 * 11 of them orphaned — see below). No MySQL/MariaDB container is needed:
 * the dump writes one fully-regular INSERT per row, parsed directly as text
 * by src/scripts/legacySqlParser.ts.
 *
 * What this does NOT port, and why:
 * - Legacy passwords are md5(md5($text)) and are not compatible with
 *   Payload's auth hashing. Each migrated user gets a random temporary
 *   password, printed once at the end. Reset both before relying on login.
 * - `fee` has no created_by or timestamp columns in the legacy schema.
 *   Migrated fees are attributed to Chris (legacy user 1), and createdAt
 *   will read as the import time, not when the fee was actually entered.
 * - 11 legacy payment rows reference 7 fee ids that don't exist in this
 *   dump (658, 661, 831, 833, 836, 837, 983) — fees deleted at some point
 *   after those payments were recorded. They're dropped; there is nothing
 *   to attach them to.
 *
 * Every Fee is created with `context: { skipFanOut: true }` so the normal
 * afterChange fan-out hook does not run — this script creates the Payment
 * rows itself, backfilled from (or absent from) the legacy payment table.
 */

import 'dotenv/config'
import { randomBytes } from 'crypto'
import { readFileSync } from 'fs'
import { getPayload, type Payload } from 'payload'

import config from '../payload.config'
import { splitEvenly, toCents } from '../lib/money'
import { monthStartFromParts } from '../lib/months'
import { parseInsertsForTable } from './legacySqlParser'

const DEFAULT_DUMP_PATH =
  '/Users/chrisdart/Sites/exp.cerebratorium.com/db-backups/new-2026-08-04-23-39-45.sql'

type LegacyUser = {
  id: number
  username: string
  firstName: string
  lastName: string
  email: string
  isActive: boolean
  role: 'user' | 'admin'
  startDate: string
  endDate: string | null
}

type LegacyFee = {
  id: number
  type: string
  amt: string
  mo: number
  yr: number
}

type LegacyPayment = {
  id: number
  userId: number
  feeId: number | null
  datePaid: string
  recModifier: number
}

function randomTempPassword(): string {
  return randomBytes(18).toString('base64url')
}

function parseLegacyUsers(sql: string): LegacyUser[] {
  return parseInsertsForTable(sql, 'user').map((row) => {
    const [id, username, , firstName, lastName, email, , , isActive, role, startDate, endDate] =
      row
    return {
      id: id as number,
      username: username as string,
      firstName: firstName as string,
      lastName: lastName as string,
      email: email as string,
      isActive: Boolean(isActive),
      role: role as 'user' | 'admin',
      startDate: startDate as string,
      endDate: (endDate as string | null) ?? null,
    }
  })
}

function parseLegacyFees(sql: string): LegacyFee[] {
  return parseInsertsForTable(sql, 'fee').map((row) => {
    const [id, type, amt, mo, yr] = row
    return { id: id as number, type: type as string, amt: String(amt), mo: mo as number, yr: yr as number }
  })
}

function parseLegacyPayments(sql: string): LegacyPayment[] {
  return parseInsertsForTable(sql, 'payment').map((row) => {
    const [id, userId, feeId, datePaid, recModifier] = row
    return {
      id: id as number,
      userId: userId as number,
      feeId: feeId as number | null,
      datePaid: datePaid as string,
      recModifier: recModifier as number,
    }
  })
}

async function assertDatabaseIsEmpty(payload: Payload) {
  const [fees, months, categories, users] = await Promise.all([
    payload.count({ collection: 'fees' }),
    payload.count({ collection: 'months' }),
    payload.count({ collection: 'categories' }),
    payload.count({ collection: 'users' }),
  ])
  const total = fees.totalDocs + months.totalDocs + categories.totalDocs + users.totalDocs
  if (total > 0) {
    throw new Error(
      `Refusing to migrate into a non-empty database (fees=${fees.totalDocs}, months=${months.totalDocs}, ` +
        `categories=${categories.totalDocs}, users=${users.totalDocs}). This script is one-shot and does not ` +
        `merge; clear these collections first if you intend to re-run it.`,
    )
  }
}

async function main() {
  const dumpPath = process.argv[2] ?? DEFAULT_DUMP_PATH
  console.log(`Reading legacy dump from ${dumpPath}`)
  const sql = readFileSync(dumpPath, 'utf-8')

  const legacyUsers = parseLegacyUsers(sql)
  const legacyFees = parseLegacyFees(sql)
  const legacyPayments = parseLegacyPayments(sql)
  console.log(
    `Parsed ${legacyUsers.length} users, ${legacyFees.length} fees, ${legacyPayments.length} payments from the dump.`,
  )

  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  await assertDatabaseIsEmpty(payload)

  // --- Users ---------------------------------------------------------
  const userIdMap = new Map<number, number>() // legacy id -> new id
  const tempPasswords: { email: string; password: string }[] = []

  for (const legacyUser of legacyUsers) {
    const password = randomTempPassword()
    const created = await payload.create({
      collection: 'users',
      data: {
        email: legacyUser.email,
        password,
        name: `${legacyUser.firstName} ${legacyUser.lastName}`.trim(),
        roles: [legacyUser.role === 'admin' ? 'admin' : 'member'],
        isActive: legacyUser.isActive,
        startDate: legacyUser.startDate,
        endDate: legacyUser.endDate,
      },
    })
    userIdMap.set(legacyUser.id, created.id)
    tempPasswords.push({ email: legacyUser.email, password })
  }
  console.log(`Created ${userIdMap.size} users.`)

  // --- Categories: DISTINCT fee.type, in first-seen order -------------
  const categoryIdMap = new Map<string, number>() // legacy type -> new id
  for (const fee of legacyFees) {
    if (categoryIdMap.has(fee.type)) continue
    const created = await payload.create({
      collection: 'categories',
      data: { name: fee.type },
    })
    categoryIdMap.set(fee.type, created.id)
  }
  console.log(`Created ${categoryIdMap.size} categories.`)

  // --- Months: DISTINCT (mo, yr) ---------------------------------------
  const monthIdMap = new Map<string, number>() // "yr-mo" -> new id
  for (const fee of legacyFees) {
    const key = `${fee.yr}-${fee.mo}`
    if (monthIdMap.has(key)) continue
    const created = await payload.create({
      collection: 'months',
      data: { startsOn: monthStartFromParts(fee.mo, fee.yr).toISOString() },
    })
    monthIdMap.set(key, created.id)
  }
  console.log(`Created ${monthIdMap.size} months.`)

  // --- Fees + fanned-out Payments --------------------------------------
  // Index legacy payments by (userId, feeId) for O(1) lookup while fanning
  // out, and separately track how many point at a fee this dump doesn't have.
  const paymentsByUserAndFee = new Map<string, LegacyPayment>()
  let orphanedPayments = 0
  const knownFeeIds = new Set(legacyFees.map((f) => f.id))
  for (const payment of legacyPayments) {
    if (payment.feeId === null || !knownFeeIds.has(payment.feeId)) {
      orphanedPayments++
      continue
    }
    paymentsByUserAndFee.set(`${payment.userId}-${payment.feeId}`, payment)
  }

  const chrisLegacyId = legacyUsers.find((u) => u.username === 'chris')?.id
  const createdByNewId = chrisLegacyId ? userIdMap.get(chrisLegacyId) : undefined
  if (!createdByNewId) {
    throw new Error("Could not resolve 'chris' as the attribution user for migrated fees.")
  }

  // Both legacy users' startDate predates every fee in this dump (earliest
  // fee: 1997-09-01/2016-05-01 vs 2018-04), so every fee here splits across
  // both. A later migration from a dump with newer members wouldn't be able
  // to assume this — this script resolves active users per fee's month for
  // correctness, not just convenience.
  const allUserRows = await payload.find({ collection: 'users', sort: 'id', limit: 0, depth: 0 })

  let totalPaymentsCreated = 0
  let paidCount = 0
  let unpaidCount = 0

  for (const fee of legacyFees) {
    const monthId = monthIdMap.get(`${fee.yr}-${fee.mo}`)!
    const categoryId = categoryIdMap.get(fee.type)!
    const amountCents = toCents(fee.amt)

    const createdFee = await payload.create({
      collection: 'fees',
      data: {
        month: monthId,
        category: categoryId,
        amountCents,
        createdBy: createdByNewId,
      },
      context: { skipFanOut: true },
    })

    const monthStart = monthStartFromParts(fee.mo, fee.yr)
    const monthEnd = new Date(Date.UTC(fee.yr, fee.mo, 0, 23, 59, 59, 999))
    const activeLegacyUsers = legacyUsers.filter((u) => {
      if (new Date(u.startDate) > monthEnd) return false
      if (u.endDate && new Date(u.endDate) < monthStart) return false
      return true
    })
    // Sort by NEW id, matching the order findActiveUsersForMonth would use at
    // runtime, so the rotation-indexed split lands the same way it would have
    // had this fee been created live instead of migrated.
    const activeNewIds = activeLegacyUsers
      .map((u) => userIdMap.get(u.id)!)
      .sort((a, b) => a - b)

    const shares = splitEvenly(amountCents, activeNewIds.length, createdFee.id)

    for (const [index, userId] of activeNewIds.entries()) {
      const legacyUserId = legacyUsers.find((u) => userIdMap.get(u.id) === userId)!.id
      const legacyPayment = paymentsByUserAndFee.get(`${legacyUserId}-${fee.id}`)

      await payload.create({
        collection: 'payments',
        data: {
          fee: createdFee.id,
          user: userId,
          shareCents: shares[index],
          paidOn: legacyPayment?.datePaid ?? null,
          recordedBy: legacyPayment ? userIdMap.get(legacyPayment.recModifier) ?? null : null,
        },
        context: { skipFanOut: true },
      })
      totalPaymentsCreated++
      if (legacyPayment) paidCount++
      else unpaidCount++
    }
  }

  console.log(`Created ${legacyFees.length} fees.`)
  console.log(
    `Created ${totalPaymentsCreated} payments (${paidCount} paid, ${unpaidCount} unpaid).`,
  )
  console.log(`Skipped ${orphanedPayments} orphaned legacy payment row(s) with no matching fee.`)
  console.log(`(Active users considered: ${allUserRows.totalDocs})`)

  console.log('\n=== TEMPORARY PASSWORDS — set real passwords and discard these ===')
  for (const { email, password } of tempPasswords) {
    console.log(`  ${email}: ${password}`)
  }
  console.log('====================================================================\n')

  await payload.db.destroy?.()
}

main()
  .then(() => {
    console.log('Migration complete.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
