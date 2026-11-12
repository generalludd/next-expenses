import { formatMoney } from '@/lib/money'
import type { FeeLine } from '@/lib/monthSummary'
import { togglePaymentStatusAction } from '../actions'

/**
 * `canToggle` is false for members looking at someone else's payment: they
 * see the status but can't change it (Payments' update access enforces the
 * same rule server-side).
 */
export function PaymentLine({ fee, payment, canToggle }: FeeLine & { canToggle: boolean }) {
  const isPaid = Boolean(payment.paidOn)
  const status = isPaid ? 'paid' : 'unpaid'
  const label = isPaid ? 'Paid' : 'Unpaid'

  return (
    <tr>
      <td>{fee.category.name}</td>
      <td className="amount">{formatMoney(payment.shareCents)}</td>
      <td>
        {canToggle ? (
          <form action={togglePaymentStatusAction.bind(null, payment.id)}>
            <button type="submit" className={`status-badge ${status}`}>
              {label}
            </button>
          </form>
        ) : (
          <span className={`status-badge ${status}`}>{label}</span>
        )}
      </td>
    </tr>
  )
}
