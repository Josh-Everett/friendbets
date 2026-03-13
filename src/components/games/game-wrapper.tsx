'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils'
import type { GameResult } from '@/lib/games/types'

interface GameWrapperProps {
  groupId: string
  groupSlug: string
  gameSlug: string
  gameName: string
  gameIcon: string
  userId: string
  userBalance: number
  currencySymbol: string
  dailyHigh: number | null
  dailyHighUser: string | null
  allTimeHigh: number | null
  allTimeHighUser: string | null
  prizePool: number
  children: (props: {
    onGameEnd: (result: GameResult) => void
    onGameStart: () => void
  }) => React.ReactNode
}

interface SubmitResult {
  won_pool: boolean
  payout: number
  new_daily_high: number
  new_pool: number
  new_balance: number
}

export function GameWrapper({
  groupId,
  groupSlug,
  gameSlug,
  gameName,
  gameIcon,
  userId,
  userBalance,
  currencySymbol,
  dailyHigh,
  dailyHighUser,
  allTimeHigh,
  allTimeHighUser,
  prizePool,
  children,
}: GameWrapperProps) {
  const router = useRouter()
  const { toast } = useToast()

  const [phase, setPhase] = useState<'idle' | 'active' | 'submitting'>('idle')
  const [betAmount, setBetAmount] = useState('')
  const [gameKey, setGameKey] = useState(0)
  const [result, setResult] = useState<{ score: number; response: SubmitResult } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const canBet = dailyHigh != null
  const betNum = Number(betAmount) || 0

  const quickPicks = [
    { label: '10%', value: Math.floor(userBalance * 0.1) },
    { label: '25%', value: Math.floor(userBalance * 0.25) },
    { label: '50%', value: Math.floor(userBalance * 0.5) },
    { label: 'All In', value: userBalance },
  ]

  function handleStartGame() {
    if (canBet && betNum > userBalance) {
      toast('Not enough balance', 'error')
      return
    }
    setResult(null)
    setPhase('active')
    setGameKey((k) => k + 1)
  }

  const handleGameStart = useCallback(() => {
    // Game is now active (player tapped to start)
  }, [])

  const handleGameEnd = useCallback(async (gameResult: GameResult) => {
    setPhase('submitting')
    setSubmitting(true)

    try {
      const res = await fetch('/api/games/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          game_type: gameSlug,
          score: gameResult.score,
          bet_amount: canBet ? betNum : 0,
          metadata: gameResult.metadata || {},
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast(data.error || 'Failed to submit score', 'error')
        setPhase('idle')
      } else {
        const data: SubmitResult = await res.json()
        setResult({ score: gameResult.score, response: data })

        if (data.won_pool) {
          toast(`You won the pool! +${formatCurrency(data.payout, currencySymbol)}`, 'success')
        } else if (gameResult.score > (dailyHigh ?? 0)) {
          toast('New daily high score!', 'success')
        }
      }
    } catch {
      toast('Network error', 'error')
      setPhase('idle')
    }

    setSubmitting(false)
  }, [groupId, gameSlug, canBet, betNum, currencySymbol, dailyHigh, toast])

  function handlePlayAgain() {
    setResult(null)
    setBetAmount('')
    setPhase('idle')
    router.refresh()
  }

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{gameIcon}</span>
          <h1 className="text-xl font-bold text-white">{gameName}</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push(`/groups/${groupSlug}?tab=games`)}>
          Back
        </Button>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {dailyHigh != null ? (
          <Badge variant="default">
            Today: {dailyHigh}{dailyHighUser ? ` by ${dailyHighUser}` : ''}
          </Badge>
        ) : (
          <Badge variant="default">No plays today</Badge>
        )}
        {allTimeHigh != null && (
          <Badge variant="warning">
            Record: {allTimeHigh}{allTimeHighUser ? ` by ${allTimeHighUser}` : ''}
          </Badge>
        )}
        {prizePool > 0 && (
          <Badge variant="gold">
            Pool: {formatCurrency(prizePool, currencySymbol)}
          </Badge>
        )}
        <span className="text-sm text-[#fdd160] font-semibold ml-auto">
          {formatCurrency(result?.response.new_balance ?? userBalance, currencySymbol)}
        </span>
      </div>

      {/* Idle: betting + start */}
      {phase === 'idle' && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-white">
              {canBet ? 'Place Your Bet' : 'Set the Daily High Score'}
            </h2>
            {!canBet && (
              <p className="text-sm text-[#a2a8cc]">
                Be the first to play today! Your score sets the target for others.
              </p>
            )}
            {canBet && prizePool > 0 && (
              <p className="text-sm text-[#a2a8cc]">
                Beat {dailyHigh} to win the {formatCurrency(prizePool, currencySymbol)} pool!
              </p>
            )}
            {canBet && prizePool === 0 && (
              <p className="text-sm text-[#a2a8cc]">
                Beat {dailyHigh} to claim the pool. Your bet seeds it if you lose.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {canBet && (
              <>
                <Input
                  id="bet-amount"
                  label="Bet Amount"
                  type="number"
                  value={betAmount}
                  onChange={(e) => setBetAmount(e.target.value)}
                  min={0}
                  max={userBalance}
                  placeholder="0 for free play"
                />
                <div className="flex gap-2">
                  {quickPicks.map((qp) => (
                    <button
                      key={qp.label}
                      onClick={() => setBetAmount(String(qp.value))}
                      className="flex-1 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-[#a2a8cc] hover:bg-white/5 hover:text-white transition-colors"
                    >
                      {qp.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            <Button onClick={handleStartGame} className="w-full" size="lg">
              {canBet && betNum > 0
                ? `Play for ${formatCurrency(betNum, currencySymbol)}`
                : 'Play Free'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active / submitting: show the game */}
      {(phase === 'active' || phase === 'submitting') && (
        <div className="space-y-4">
          {canBet && betNum > 0 && !result && (
            <div className="text-center text-sm text-[#a2a8cc]">
              Bet: <span className="text-[#fdd160] font-semibold">{formatCurrency(betNum, currencySymbol)}</span>
              {dailyHigh != null && <> &middot; Target: <span className="text-white font-semibold">{dailyHigh}</span></>}
            </div>
          )}

          <div key={gameKey}>
            {children({
              onGameEnd: handleGameEnd,
              onGameStart: handleGameStart,
            })}
          </div>

          {/* Result overlay */}
          {result && (
            <Card>
              <CardContent className="py-5 space-y-4 text-center">
                <div>
                  <p className="text-3xl font-bold text-[#fdd160]">{result.score}</p>
                  <p className="text-sm text-[#a2a8cc]">pipes cleared</p>
                </div>

                {result.response.won_pool && (
                  <div className="bg-[#fdd160]/10 border border-[#fdd160]/30 rounded-lg p-3">
                    <p className="text-[#fdd160] font-bold text-lg">
                      Pool Won! +{formatCurrency(result.response.payout, currencySymbol)}
                    </p>
                    <p className="text-sm text-[#a2a8cc]">New daily high score!</p>
                  </div>
                )}

                {!result.response.won_pool && result.score > (dailyHigh ?? 0) && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                    <p className="text-green-400 font-semibold">New Daily High Score!</p>
                    {betNum > 0 && <p className="text-sm text-[#a2a8cc]">No pool to claim yet</p>}
                  </div>
                )}

                {!result.response.won_pool && result.score <= (dailyHigh ?? 0) && betNum > 0 && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <p className="text-red-400 font-semibold">
                      Better luck next time
                    </p>
                    <p className="text-sm text-[#a2a8cc]">
                      {formatCurrency(betNum, currencySymbol)} added to the pool
                    </p>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={handlePlayAgain} className="flex-1">
                    Play Again
                  </Button>
                  <Button variant="ghost" onClick={() => router.push(`/groups/${groupSlug}?tab=games`)} className="flex-1">
                    Back to Games
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {submitting && !result && (
            <p className="text-center text-sm text-[#a2a8cc] animate-pulse">Submitting score...</p>
          )}
        </div>
      )}
    </div>
  )
}
