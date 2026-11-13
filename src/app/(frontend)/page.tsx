import Link from 'next/link'

import type { Payment } from '@/payload-types'
import { isAdmin } from '@/access/adminOnly'
import { formatMoney } from '@/lib/money'
import { nextMonth, previousMonth } from '@/lib/months'
import { getCopyCandidates, getMonthSummary } from '@/lib/monthSummary'
import { requireUser } from '@/lib/requireUser'
import { CopyFeeRow } from './_components/CopyFeeRow'
import { DeleteFeeButton } from './_components/DeleteFeeButton'
import { FeeDialog } from './_components/FeeDialog'
import { PaymentLine } from './_components/PaymentLine'
import { AppHeader } from './_components/AppHeader'
import { createMonthAction, setCategorySkippedAction } from './actions'

/**
 * Parses the month and year from the search params, defaulting to the current month and year if not provided or invalid.
 * @param searchParams
 * @returns
 */
function parseMonthYear(searchParams: { month?: string; year?: string }): {
  month: number
  year: number
} {
  const now = new Date()
  const defaultMonth = now.getUTCMonth() + 1
  const defaultYear = now.getUTCFullYear()

  const month = Number(searchParams.month)
  const year = Number(searchParams.year)

  return {
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : defaultMonth,
    year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : defaultYear,
  }
}

export default async function HomePage(props: {
  searchParams: Promise<{ month?: string; year?: string }>
}) {
  const searchParams = await props.searchParams
  const { payload, user } = await requireUser()

  const { month, year } = parseMonthYear(searchParams)
  const summary = await getMonthSummary(payload, month, year)
  const prev = previousMonth(month, year)
  const next = nextMonth(month, year)
  // Members see the month and can mark their own payments; everything that
  // changes fees or months is admin-only (enforced again by access rules).
  const admin = isAdmin(user)
  const canToggle = (payment: Payment) =>
    admin || (typeof payment.user === 'object' ? payment.user.id : payment.user) === user.id
  const copyCandidates =
    admin && summary.monthDoc
      ? await getCopyCandidates(payload, summary.monthDoc, month, year, summary.fees)
      : null
  // Fees with any paid share can't be deleted (see deleteFeeAction).
  const feeIdsWithPaidShares = new Set(
    summary.users.flatMap((userSummary) => userSummary.paid.map((line) => line.fee.id)),
  )
  const { docs: categoryDocs } = await payload.find({
    collection: 'categories',
    sort: 'name',
    limit: 0,
    depth: 0,
  })
  const categories = categoryDocs.map((category) => ({ id: category.id, name: category.name }))

  return (
    <div className="app">
      <AppHeader user={user} />

      <main className="app-main">
        <div className="container">
          <div className="month-nav">
            <Link href={`/?month=${prev.month}&year=${prev.year}`} className="btn-nav">
              ← Previous
            </Link>
            <h2>{summary.monthLabel}</h2>
            <Link href={`/?month=${next.month}&year=${next.year}`} className="btn-nav">
              Next →
            </Link>
          </div>

          {admin && (
            <div className="month-toolbar">
              {/* Keyed so the form's defaults follow the month being viewed. */}
              <FeeDialog
                key={`add-${month}-${year}`}
                categories={categories}
                month={month}
                year={year}
                triggerLabel="+ Add fee"
                triggerClassName="btn-primary"
              />
            </div>
          )}

          {!summary.monthDoc ? (
            <div className="empty-state">
              <p>No fees recorded for {summary.monthLabel} yet.</p>
              {admin && (
                <form action={createMonthAction.bind(null, month, year)}>
                  <button type="submit" className="btn-primary">
                    Create {summary.monthLabel}
                  </button>
                </form>
              )}
            </div>
          ) : (
            <>
              <div className="month-summary">
                <div className="summary-card">
                  <span className="summary-label">Total Fees</span>
                  <span className="summary-value">{formatMoney(summary.totalFeeCents)}</span>
                </div>
                <div className="summary-card">
                  <span className="summary-label">Active Users</span>
                  <span className="summary-value">{summary.users.length}</span>
                </div>
              </div>

              {copyCandidates &&
                (copyCandidates.fees.length > 0 || copyCandidates.skipped.length > 0) && (
                  <div className="fees-section copy-section">
                    <h2>Copy from {copyCandidates.prevLabel}</h2>
                    {copyCandidates.fees.length > 0 && (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th className="amount">Last Month</th>
                            <th>Amount for {summary.monthLabel}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {copyCandidates.fees.map((fee) => (
                            <CopyFeeRow key={fee.id} fee={fee} monthId={summary.monthDoc!.id} />
                          ))}
                        </tbody>
                      </table>
                    )}
                    {copyCandidates.skipped.length > 0 && (
                      <ul className="skipped-list">
                        {copyCandidates.skipped.map((fee) => (
                          <li key={fee.id}>
                            <span>Skipped: {fee.category.name}</span>
                            <form
                              action={setCategorySkippedAction.bind(
                                null,
                                summary.monthDoc!.id,
                                fee.category.id,
                                false,
                              )}
                            >
                              <button type="submit" className="btn-text">
                                Undo
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

              {summary.fees.length > 0 && (
                <div className="fees-section">
                  <h2>Fees for {summary.monthLabel}</h2>
                  <table className="data-table fees-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="amount">Total Amount</th>
                        {admin && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {summary.fees.map((fee) => (
                        <tr key={fee.id}>
                          <td>
                            <strong>{fee.category.name}</strong>
                          </td>
                          <td className="amount">{formatMoney(fee.amountCents)}</td>
                          {admin && (
                            <td className="row-actions">
                              {/* Keyed on the saved values so the form resets to them after an edit. */}
                              <FeeDialog
                                key={`edit-${fee.id}-${fee.category.id}-${fee.amountCents}`}
                                categories={categories}
                                month={month}
                                year={year}
                                fee={{
                                  id: fee.id,
                                  categoryId: fee.category.id,
                                  amountCents: fee.amountCents,
                                }}
                                triggerLabel="Edit"
                                triggerClassName="btn-secondary btn-small"
                              />
                              {feeIdsWithPaidShares.has(fee.id) ? (
                                <span
                                  className="muted"
                                  title="Mark its payments unpaid before deleting this fee."
                                >
                                  Has payments
                                </span>
                              ) : (
                                <DeleteFeeButton feeId={fee.id} categoryName={fee.category.name} />
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="total-row">
                        <td>
                          <strong>Total</strong>
                        </td>
                        <td className="amount">
                          <strong>{formatMoney(summary.totalFeeCents)}</strong>
                        </td>
                        {admin && <td></td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {summary.users.map((userSummary) => (
                <div className="user-section" key={userSummary.user.id}>
                  <h3 className="user-name">{userSummary.user.name || userSummary.user.email}</h3>

                  <div className="user-summary">
                    <div className="user-stat">
                      <span className="stat-label">Amount Paid</span>
                      <span className="stat-value paid">{formatMoney(userSummary.paidCents)}</span>
                    </div>
                    <div className="user-stat">
                      <span className="stat-label">Amount Owed</span>
                      <span className="stat-value owed">{formatMoney(userSummary.owedCents)}</span>
                    </div>
                  </div>

                  {userSummary.unpaid.length > 0 && (
                    <div className="data-section">
                      <h4 className="unpaid-header">Unpaid Fees</h4>
                      <table className="data-table unpaid">
                        <thead>
                          <tr>
                            <th>Fee</th>
                            <th className="amount">Amount Due</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {userSummary.unpaid.map((line) => (
                            <PaymentLine
                              key={line.payment.id}
                              {...line}
                              canToggle={canToggle(line.payment)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {userSummary.paid.length > 0 && (
                    <div className="data-section">
                      <h4 className="paid-header">Paid Fees</h4>
                      <table className="data-table paid">
                        <thead>
                          <tr>
                            <th>Fee</th>
                            <th className="amount">Amount</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {userSummary.paid.map((line) => (
                            <PaymentLine
                              key={line.payment.id}
                              {...line}
                              canToggle={canToggle(line.payment)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </main>

      <footer className="app-footer">
        <div className="container">
          <p>Expenses</p>
        </div>
      </footer>
    </div>
  )
}
