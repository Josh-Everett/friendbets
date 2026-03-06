export const dynamic = 'force-dynamic'

import { LoginForm } from '@/components/auth/login-form'

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">FriendBets</h1>
          <p className="text-[#a2a8cc] mt-2">Welcome back</p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
