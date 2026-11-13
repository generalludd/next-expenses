import { redirect } from 'next/navigation'

import { isAdmin } from '@/access/adminOnly'
import { requireUser } from '@/lib/requireUser'
import { AppHeader } from '../_components/AppHeader'
import { UserDialog } from '../_components/UserDialog'

/** ISO timestamp -> "YYYY-MM-DD" for a date input (dates are stored at UTC midnight). */
function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : ''
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(iso),
  )
}

export default async function UsersPage() {
  const { payload, user } = await requireUser()
  if (!isAdmin(user)) {
    redirect('/')
  }

  const { docs: users } = await payload.find({
    collection: 'users',
    sort: 'name',
    limit: 0,
    depth: 0,
  })

  return (
    <div className="app">
      <AppHeader user={user} />

      <main className="app-main">
        <div className="container">
          <div className="fees-section">
            <div className="section-header">
              <h2>Users</h2>
              <UserDialog triggerLabel="+ Add user" triggerClassName="btn-primary" />
            </div>
            <table className="data-table users-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Left</th>
                  <th>Login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((member) => {
                  const memberIsAdmin = isAdmin(member)
                  const loginEnabled = member.isActive !== false
                  return (
                    <tr key={member.id}>
                      <td>
                        <strong>{member.name || '—'}</strong>
                      </td>
                      <td>{member.email}</td>
                      <td>{memberIsAdmin ? 'Admin' : 'Member'}</td>
                      <td>{formatDate(member.startDate)}</td>
                      <td>{formatDate(member.endDate)}</td>
                      <td>
                        <span className={`status-badge ${loginEnabled ? 'paid' : 'unpaid'}`}>
                          {loginEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td className="row-actions">
                        {/* Keyed on updatedAt so the form resets to the saved values after an edit. */}
                        <UserDialog
                          key={`${member.id}-${member.updatedAt}`}
                          user={{
                            id: member.id,
                            name: member.name ?? '',
                            email: member.email,
                            admin: memberIsAdmin,
                            isActive: loginEnabled,
                            startDate: toDateInput(member.startDate),
                            endDate: toDateInput(member.endDate),
                          }}
                          isSelf={member.id === user.id}
                          triggerLabel="Edit"
                          triggerClassName="btn-secondary btn-small"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
