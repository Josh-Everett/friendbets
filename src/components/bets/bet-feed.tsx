'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { BetCard } from './bet-card'
import { CreateBetForm } from './create-bet-form'
import { useRealtimeBets } from '@/hooks/use-realtime-bets'

interface BetFeedProps {
  groupId: string
  groupSlug: string
  userId: string
  members: any[]
  currencySymbol: string
  userBalance: number
  startingBalance: number
}

export function BetFeed({ groupId, groupSlug, userId, members, currencySymbol, userBalance, startingBalance }: BetFeedProps) {
  const bets = useRealtimeBets(groupId)
  const [showCreate, setShowCreate] = useState(false)

  const activeBets = bets.filter((b) => b.status === 'open' || b.status === 'locked')

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus size={16} />
          New Bet
        </Button>
      </div>

      {activeBets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-[#a2a8cc] mb-4">No active bets</p>
            <Button onClick={() => setShowCreate(true)}>Create the first bet</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activeBets.map((bet) => (
            <BetCard
              key={bet.id}
              bet={bet}
              groupSlug={groupSlug}
              currencySymbol={currencySymbol}
            />
          ))}
        </div>
      )}

      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="Create New Bet">
        <CreateBetForm
          groupId={groupId}
          userId={userId}
          members={members}
          userBalance={userBalance}
          startingBalance={startingBalance}
          onSuccess={() => setShowCreate(false)}
        />
      </Dialog>
    </div>
  )
}
