'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'

interface ResolutionPanelProps {
  bet: any
  userId: string
  isCreator: boolean
  userVote: any
  members: any[]
  groupId: string
}

export function ResolutionPanel({ bet, userId, isCreator, userVote, members, groupId }: ResolutionPanelProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)

  const handleLock = async () => {
    setLoading(true)
    const res = await fetch('/api/bets/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet_id: bet.id }),
    })
    if (!res.ok) {
      const data = await res.json()
      toast(data.error || 'Failed to lock bet', 'error')
    } else {
      toast('Bet locked! No more wagers.', 'success')
      router.refresh()
    }
    setLoading(false)
  }

  const handleResolve = async (outcome: boolean) => {
    setLoading(true)
    const res = await fetch('/api/bets/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet_id: bet.id, outcome }),
    })
    if (!res.ok) {
      const data = await res.json()
      toast(data.error || 'Failed to resolve bet', 'error')
    } else {
      toast('Bet resolved!', 'success')
      router.refresh()
    }
    setLoading(false)
  }

  const handleCancel = async () => {
    setLoading(true)
    const res = await fetch('/api/bets/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet_id: bet.id }),
    })
    if (!res.ok) {
      const data = await res.json()
      toast(data.error || 'Failed to cancel bet', 'error')
    } else {
      toast('Bet cancelled. Wagers refunded.', 'info')
      router.refresh()
    }
    setLoading(false)
  }

  const handleVote = async (vote: boolean) => {
    setLoading(true)
    const res = await fetch('/api/bets/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet_id: bet.id, vote }),
    })
    if (!res.ok) {
      const data = await res.json()
      toast(data.error || 'Failed to vote', 'error')
    } else {
      toast('Vote cast!', 'success')
      router.refresh()
    }
    setLoading(false)
  }

  // Payout preview based on shares
  const forWagers = bet.bet_wagers?.filter((w: any) => w.side === 'for') ?? []
  const againstWagers = bet.bet_wagers?.filter((w: any) => w.side === 'against') ?? []
  const totalPot = (bet.bet_wagers ?? []).reduce((s: number, w: any) => s + w.amount, 0)
  const totalYesShares = forWagers.reduce((s: number, w: any) => s + Number(w.shares || 0), 0)
  const totalNoShares = againstWagers.reduce((s: number, w: any) => s + Number(w.shares || 0), 0)

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold text-white">Resolution</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Lock button */}
        {bet.status === 'open' && isCreator && (
          <Button variant="secondary" onClick={handleLock} loading={loading} className="w-full">
            Lock Bet (stop wagers)
          </Button>
        )}

        {/* Payout preview */}
        {totalPot > 0 && (bet.status === 'open' || bet.status === 'locked') && (
          <div className="bg-[#1a2340] rounded-lg p-3 space-y-1">
            <p className="text-xs font-medium text-[#a2a8cc]">Payout Preview (shares-based)</p>
            <div className="flex justify-between text-xs">
              <span className="text-green-400">
                If &quot;Yes&quot;: {totalYesShares > 0
                  ? `${totalYesShares.toFixed(1)} winning shares split the pot`
                  : 'No For wagers — all refunded'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-red-400">
                If &quot;No&quot;: {totalNoShares > 0
                  ? `${totalNoShares.toFixed(1)} winning shares split the pot`
                  : 'No Against wagers — all refunded'}
              </span>
            </div>
          </div>
        )}

        {/* Creator resolution */}
        {bet.resolution_method === 'creator' && isCreator && (
          <div className="space-y-3">
            <p className="text-sm text-[#a2a8cc]">As the creator, you decide the outcome:</p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="gold" onClick={() => handleResolve(true)} loading={loading}>
                It Happened
              </Button>
              <Button variant="secondary" onClick={() => handleResolve(false)} loading={loading}>
                Didn&apos;t Happen
              </Button>
            </div>
          </div>
        )}

        {/* Vote resolution */}
        {bet.resolution_method === 'vote' && (
          <div className="space-y-3">
            <p className="text-sm text-[#a2a8cc]">Cast your vote:</p>
            {!userVote ? (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="gold" onClick={() => handleVote(true)} loading={loading}>
                  It Happened
                </Button>
                <Button variant="secondary" onClick={() => handleVote(false)} loading={loading}>
                  Didn&apos;t Happen
                </Button>
              </div>
            ) : (
              <p className="text-sm text-[#a2a8cc]">
                You voted: {userVote.vote ? 'Happened' : 'Didn\'t happen'}
              </p>
            )}
            {/* Vote tally */}
            <div className="bg-[#1a2340] rounded-lg p-3">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-green-400">
                  Happened: {bet.bet_votes?.filter((v: any) => v.vote).length ?? 0}
                </span>
                <span className="text-red-400">
                  Didn&apos;t: {bet.bet_votes?.filter((v: any) => !v.vote).length ?? 0}
                </span>
              </div>
              <p className="text-xs text-[#a2a8cc]">
                {bet.bet_votes?.length ?? 0} / {members.length} members voted
              </p>
            </div>
            {/* Admin can force resolve vote-based bets */}
            {isCreator && bet.bet_votes && bet.bet_votes.length >= Math.ceil(members.length / 2) && (
              <div className="pt-2">
                <p className="text-xs text-[#a2a8cc] mb-2">Majority reached. Finalize?</p>
                <Button
                  onClick={() => {
                    const forVotes = bet.bet_votes.filter((v: any) => v.vote).length
                    const againstVotes = bet.bet_votes.filter((v: any) => !v.vote).length
                    if (forVotes === againstVotes) {
                      handleCancel()
                    } else {
                      handleResolve(forVotes > againstVotes)
                    }
                  }}
                  loading={loading}
                  className="w-full"
                >
                  Finalize Vote Result
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Cancel button */}
        {(isCreator) && (
          <Button variant="danger" onClick={handleCancel} loading={loading} className="w-full" size="sm">
            Cancel Bet (refund all)
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
