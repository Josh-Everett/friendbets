export const dynamic = 'force-dynamic'

import { SignupForm } from '@/components/auth/signup-form'

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">FriendBets</h1>
          <p className="text-[#a2a8cc] mt-2">Create your account</p>
        </div>
        <SignupForm redirectTo={next} />
      </div>
    </div>
  )
}
