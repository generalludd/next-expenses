import Link from 'next/link'

import { isAdmin } from '@/access/adminOnly'
import type { User } from '@/payload-types'
import { logoutAction } from '../actions'

/** Shared by the dashboard and /users. Admins also get a link to /users. */
export function AppHeader({ user }: { user: User }) {
  return (
    <header className="app-header">
      <div className="container">
        <h1>
          <Link href="/" className="app-title">
            Expenses
          </Link>
        </h1>
        <div className="user-info">
          <p>
            Welcome, <strong>{user.name || user.email}</strong>!
          </p>
          {isAdmin(user) && (
            <Link href="/users" className="link-button">
              Users
            </Link>
          )}
          <form action={logoutAction}>
            <button type="submit" className="link-button">
              Logout
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
