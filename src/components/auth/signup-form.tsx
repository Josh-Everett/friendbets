'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { useSupabase } from '@/hooks/use-supabase'

interface SignupFormProps {
  redirectTo?: string
}

export function SignupForm({ redirectTo }: SignupFormProps) {
  const router = useRouter()
  const supabase = useSupabase()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (username.length < 3 || username.length > 30) {
      setError('Username must be 3-30 characters')
      setLoading(false)
      return
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username can only contain letters, numbers, and underscores')
      setLoading(false)
      return
    }

    // Build callback URL with optional redirect
    const callbackUrl = redirectTo
      ? `${window.location.origin}/callback?next=${encodeURIComponent(redirectTo)}`
      : `${window.location.origin}/callback`

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: username },
        emailRedirectTo: callbackUrl,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setSuccess(true)
      setLoading(false)
    }
  }

  if (success) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Check your email</h2>
          <p className="text-[#a2a8cc]">
            We sent a confirmation link to <strong className="text-white">{email}</strong>.
            Click the link to activate your account.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="username"
            label="Username"
            type="text"
            placeholder="coolname42"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            id="email"
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            id="password"
            label="Password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">
            Create Account
          </Button>
          <p className="text-center text-sm text-[#a2a8cc]">
            Already have an account?{' '}
            <a href="/login" className="text-[#ba0963] hover:underline">
              Sign in
            </a>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
