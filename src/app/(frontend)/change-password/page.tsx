import { requireUser } from '@/lib/requireUser'
import { ChangePasswordForm } from '../_components/ChangePasswordForm'

export default async function ChangePasswordPage() {
  const { user } = await requireUser({ allowPendingPasswordChange: true })

  return (
    <div className="login-page">
      <ChangePasswordForm forced={Boolean(user.mustChangePassword)} />
    </div>
  )
}
