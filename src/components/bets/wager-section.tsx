'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { getPrices, estimateTrade, estimatePayout, formatProbability, formatDecimalOdds } from '@/lib/amm'

interface WagerSectionProps {
  betId: string
  groupId: string
  userId: string
  userBalance: number
  currencySymbol: string
  yesPool: number
  noPool: number
  k: number
  totalPot: number
  totalYesShares: number
  totalNoShares: number
  existingSide?: 'for' | 'against' | null
  existingShares?: number
}

export function WagerSection({
  betId,
  groupId,
  userId,
  userBalance,
  currencySymbol,
  yesPool,
  noPool,
  k,
  totalPot,
  totalYesShares,
  totalNoShares,
  existingSide,
  existingShares,
}: WagerSectionProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [side, setSide] = useState<'for' | 'against' | null>(existingSide ?? null)
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const prices = getPrices({ yesPool, noPool, k })

  const quickPicks = [
    { label: '10%', value: Math.floor(userBalance * 0.1) },
    { label: '25%', value: Math.floor(userBalance * 0.25) },
    { label: '50%', value: Math.floor(userBalance * 0.5) },
    { label: 'All In', value: userBalance },
  ]

  // Live trade preview
  const preview = useMemo(() => {
    if (!side || !amount || Number(amount) <= 0) return null
    try {
      const trade = estimateTrade({ yesPool, noPool, k }, side, Number(amount))
      const winningShares = side === 'for'
        ? totalYesShares + trade.shares
        : totalNoShares + trade.shares
      const newTotalPot = totalPot + Number(amount)
      const myTotalShares = (existingShares || 0) + trade.shares
      const payout = estimatePayout(myTotalShares, winningShares, newTotalPot)
      return { ...trade, estimatedPayout: payout }
    } catch {
      return null
    }
  }, [side, amount, yesPool, noPool, k, totalPot, totalYesShares, totalNoShares, existingShares])

  const handlePlace = async () => {
    if (!side || !amount) return
    setLoading(true)

    const res = await fetch('/api/bets/wager', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet_id: betId, side, amount: Number(amount) }),
    })

    if (!res.ok) {
      const data = await res.json()
      toast(data.error || 'Failed to place wager', 'error')
    } else {
      toast('Wager placed!', 'success')
      router.refresh()
    }
    setLoading(false)
    setConfirming(false)
  }

  const hasExistingPosition = existingSide && existingShares && existingShares > 0

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold text-white">
          {hasExistingPosition ? 'Add to Position' : 'Place Your Wager'}
        </h2>
        <p className="text-sm text-[#a2a8cc]">Balance: {currencySymbol}{userBalance.toLocaleString()}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing position summary */}
        {hasExistingPosition && (
          <div className="bg-[#1a2340] rounded-lg p-3 space-y-1">
            <p className="text-xs font-medium text-[#a2a8cc]">Your Current Position</p>
            <p className="text-sm text-white">
              <span className={existingSide === 'for' ? 'text-green-400' : 'text-red-400'}>
                {existingSide === 'for' ? 'For' : 'Against'}
              </span>
              {' '}&mdash; {existingShares!.toFixed(1)} shares
            </p>
          </div>
        )}

        {/* Side picker */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setSide('for')}
            disabled={!!existingSide && existingSide !== 'for'}
            className={`py-3 rounded-lg text-sm font-semibold transition-colors border ${
              side === 'for'
                ? 'bg-green-500/20 border-green-500 text-green-400'
                : 'border-white/10 text-[#a2a8cc] hover:bg-white/5'
            } ${existingSide && existingSide !== 'for' ? 'opacity-30 cursor-not-allowed' : ''}`}
          >
            For ({formatProbability(prices.yesPrice)})
          </button>
          <button
            onClick={() => setSide('against')}
            disabled={!!existingSide && existingSide !== 'against'}
            className={`py-3 rounded-lg text-sm font-semibold transition-colors border ${
              side === 'against'
                ? 'bg-red-500/20 border-red-500 text-red-400'
                : 'border-white/10 text-[#a2a8cc] hover:bg-white/5'
            } ${existingSide && existingSide !== 'against' ? 'opacity-30 cursor-not-allowed' : ''}`}
          >
            Against ({formatProbability(prices.noPrice)})
          </button>
        </div>

        {side && (
          <>
            {/* Amount */}
            <Input
              id="wager-amount"
              label="Amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={1}
              max={userBalance}
              placeholder="Enter amount"
            />

            {/* Quick picks */}
            <div className="flex gap-2">
              {quickPicks.map((qp) => (
                <button
                  key={qp.label}
                  onClick={() => setAmount(String(qp.value))}
                  className="flex-1 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-[#a2a8cc] hover:bg-white/5 hover:text-white transition-colors"
                >
                  {qp.label}
                </button>
              ))}
            </div>

            {/* Trade preview */}
            {preview && (
              <div className="bg-[#1a2340] rounded-lg p-3 space-y-1">
                <p className="text-xs font-medium text-[#a2a8cc]">Trade Preview</p>
                <p className="text-sm text-white">
                  ~{preview.shares.toFixed(1)} shares at avg {preview.avgPrice.toFixed(2)}/share
                </p>
                {preview.priceImpact > 0.01 && (
                  <p className="text-xs text-yellow-400">
                    Price impact: {(preview.priceImpact * 100).toFixed(1)}%
                  </p>
                )}
                <p className="text-xs text-[#fdd160]">
                  Est. payout if wins: {currencySymbol}{Math.floor(preview.estimatedPayout).toLocaleString()} ({formatDecimalOdds(preview.avgPrice)})
                </p>
              </div>
            )}

            {/* Confirm */}
            {!confirming ? (
              <Button
                onClick={() => setConfirming(true)}
                disabled={!amount || Number(amount) <= 0 || Number(amount) > userBalance}
                className="w-full"
              >
                Review Wager
              </Button>
            ) : (
              <div className="bg-[#1a2340] rounded-lg p-4 space-y-3">
                <p className="text-sm text-white">
                  Wagering <span className="font-bold text-[#fdd160]">{currencySymbol}{Number(amount).toLocaleString()}</span>{' '}
                  <span className={side === 'for' ? 'text-green-400' : 'text-red-400'}>
                    {side === 'for' ? 'For' : 'Against'}
                  </span>
                </p>
                {preview && (
                  <div className="text-xs text-[#a2a8cc] space-y-0.5">
                    <p>~{preview.shares.toFixed(1)} shares at avg {preview.avgPrice.toFixed(2)}/share</p>
                    <p>Est. payout if wins: {currencySymbol}{Math.floor(preview.estimatedPayout).toLocaleString()}</p>
                  </div>
                )}
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setConfirming(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={handlePlace} loading={loading} className="flex-1">
                    Confirm
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
