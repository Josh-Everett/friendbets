'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useSupabase } from '@/hooks/use-supabase'

interface JoinGroupClientProps {
  groupName: string
  groupDescription: string | null
  currencyName: string
  currencySymbol: string
  startingBalance: number
  inviteCode: string
  groupId: string
}

export function JoinGroupClient({
  groupName,
  groupDescription,
  currencyName,
  currencySymbol,
  startingBalance,
  inviteCode,
  groupId,
}: JoinGroupClientProps) {
  const router = useRouter()
  const supabase = useSupabase()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleJoin = async () => {
    setLoading(true)
    setError('')

    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: inviteCode }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to join group')
      setLoading(false)
    } else {
      router.push(`/groups/${groupId}`)
      router.refresh()
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardContent className="pt-6 text-center space-y-4">
        <h1 className="text-2xl font-bold text-white">You&apos;re invited!</h1>
        <div>
          <h2 className="text-xl font-semibold text-white">{groupName}</h2>
          {groupDescription && <p className="text-[#a2a8cc] mt-1">{groupDescription}</p>}
        </div>
        <div className="bg-[#1a2340] rounded-lg p-4 space-y-2">
          <p className="text-sm text-[#a2a8cc]">Starting balance</p>
          <p className="text-2xl font-bold text-[#fdd160]">
            {currencySymbol}{startingBalance.toLocaleString()} {currencyName}
          </p>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button onClick={handleJoin} loading={loading} className="w-full" size="lg">
          Join Group
        </Button>
      </CardContent>
    </Card>
  )
}
