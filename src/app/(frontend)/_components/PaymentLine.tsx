import { formatMoney } from '@/lib/money'
import type { FeeLine } from '@/lib/monthSummary'
import { togglePaymentStatusAction } from '../actions'

export function PaymentLine({ fee, payment }: FeeLine) {
  const isPaid = Boolean(payment.paidOn)
  const status = isPaid ? 'paid' : 'unpaid'

  return (
    <tr>
      <td>{fee.category.name}</td>
      <td className="amount">{formatMoney(payment.shareCents)}</td>
      <td>
        <form action={togglePaymentStatusAction.bind(null, payment.id)}>
          <button type="submit" className={`status-badge ${status}`}>
            {isPaid ? 'Paid' : 'Unpaid'}
          </button>
        </form>
      </td>
    </tr>
  )
}
