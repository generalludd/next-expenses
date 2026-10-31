import { headers as getHeaders } from 'next/headers.js'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { formatMoney } from '@/lib/money'
import { nextMonth, previousMonth } from '@/lib/months'
import { getMonthSummary } from '@/lib/monthSummary'
import { logoutAction } from './actions'

function parseMonthYear(searchParams: { month?: string; year?: string }) {
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
  const headers = await getHeaders()
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const { user } = await payload.auth({ headers })

  if (!user) {
    redirect('/login')
  }

  const { month, year } = parseMonthYear(searchParams)
  const summary = await getMonthSummary(payload, month, year)
  const prev = previousMonth(month, year)
  const next = nextMonth(month, year)

  return (
    <div className="app">
      <header className="app-header">
        <div className="container">
          <h1>Expenses</h1>
          <div className="user-info">
            <p>
              Welcome, <strong>{user.name || user.email}</strong>!
            </p>
            <form action={logoutAction}>
              <button type="submit" className="link-button">
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>

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

          {!summary.monthDoc ? (
            <p className="empty-state">No fees recorded for {summary.monthLabel} yet.</p>
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

              {summary.fees.length > 0 && (
                <div className="fees-section">
                  <h2>Fees for {summary.monthLabel}</h2>
                  <table className="data-table fees-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th className="amount">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.fees.map((fee) => (
                        <tr key={fee.id}>
                          <td>
                            <strong>{fee.category.name}</strong>
                          </td>
                          <td className="amount">{formatMoney(fee.amountCents)}</td>
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
                          {userSummary.unpaid.map(({ fee, payment }) => (
                            <tr key={payment.id}>
                              <td>{fee.category.name}</td>
                              <td className="amount">{formatMoney(payment.shareCents)}</td>
                              <td>
                                <span className="status-badge unpaid">Unpaid</span>
                              </td>
                            </tr>
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
                          {userSummary.paid.map(({ fee, payment }) => (
                            <tr key={payment.id}>
                              <td>{fee.category.name}</td>
                              <td className="amount">{formatMoney(payment.shareCents)}</td>
                              <td>
                                <span className="status-badge paid">Paid</span>
                              </td>
                            </tr>
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
