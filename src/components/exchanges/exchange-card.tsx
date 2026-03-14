'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EXCHANGE_STATUS_COLORS } from '@/lib/constants'
import { formatDistanceToNow } from 'date-fns'

interface ExchangeCardProps {
  exchange: any
  userId: string
  currencySymbol: string
  onAction: () => void
}

export function ExchangeCard({ exchange, userId, currencySymbol, onAction }: ExchangeCardProps) {
  const [loading, setLoading] = useState('')

  const creatorName = exchange.profiles?.display_name || exchange.profiles?.username || 'Unknown'
  const claimerName = exchange.claimer?.display_name || exchange.claimer?.username || null
  const isCreator = exchange.created_by === userId
  const isClaimer = exchange.claimed_by === userId
  const isTerminal = exchange.status === 'completed' || exchange.status === 'cancelled'

  const handleAction = async (action: string) => {
    setLoading(action)
    try {
      let url = ''
      let body: Record<string, unknown> = {}

      switch (action) {
        case 'claim':
        case 'unclaim':
          url = '/api/exchanges/claim'
          body = { exchange_id: exchange.id, action }
          break
        case 'complete':
          url = '/api/exchanges/complete'
          body = { exchange_id: exchange.id }
          break
        case 'cancel':
          url = '/api/exchanges/cancel'
          body = { exchange_id: exchange.id }
          break
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        onAction()
      }
    } catch {
      // silently fail — user can retry
    } finally {
      setLoading('')
    }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-semibold text-white truncate">{exchange.title}</h3>
              <Badge className={EXCHANGE_STATUS_COLORS[exchange.status]}>{exchange.status}</Badge>
            </div>
            {exchange.description && (
              <p className="text-sm text-[#a2a8cc] line-clamp-2 mb-2">{exchange.description}</p>
            )}
            <div className="flex items-center gap-4 text-xs text-[#a2a8cc]">
              <span>by {creatorName}</span>
              <span className="text-[#fdd160] font-semibold">
                {currencySymbol}{exchange.reward.toLocaleString()}
              </span>
              {claimerName && (
                <span>claimed by {claimerName}</span>
              )}
              <span>{formatDistanceToNow(new Date(exchange.created_at), { addSuffix: true })}</span>
            </div>
          </div>

          {!isTerminal && (
            <div className="flex gap-2 shrink-0">
              {/* Open + not creator → Claim */}
              {exchange.status === 'open' && !isCreator && (
                <Button
                  size="sm"
                  onClick={() => handleAction('claim')}
                  loading={loading === 'claim'}
                >
                  Claim
                </Button>
              )}
              {/* Claimed + is claimer → Release */}
              {exchange.status === 'claimed' && isClaimer && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleAction('unclaim')}
                  loading={loading === 'unclaim'}
                >
                  Release
                </Button>
              )}
              {/* Claimed + is poster → Mark Complete + Cancel */}
              {exchange.status === 'claimed' && isCreator && (
                <>
                  <Button
                    size="sm"
                    variant="gold"
                    onClick={() => handleAction('complete')}
                    loading={loading === 'complete'}
                  >
                    Complete
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleAction('cancel')}
                    loading={loading === 'cancel'}
                  >
                    Cancel
                  </Button>
                </>
              )}
              {/* Open + is poster → Cancel */}
              {exchange.status === 'open' && isCreator && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleAction('cancel')}
                  loading={loading === 'cancel'}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
