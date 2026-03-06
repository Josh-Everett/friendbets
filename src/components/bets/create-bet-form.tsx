'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { estimateTrade, formatProbability, formatDecimalOdds } from '@/lib/amm'

interface CreateBetFormProps {
  groupId: string
  userId: string
  members: any[]
  userBalance: number
  startingBalance: number
  onSuccess: () => void
}

export function CreateBetForm({ groupId, userId, members, userBalance, startingBalance, onSuccess }: CreateBetFormProps) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [subjectUserId, setSubjectUserId] = useState<string>('')
  const [resolutionMethod, setResolutionMethod] = useState<'creator' | 'vote'>('creator')
  const [deadline, setDeadline] = useState('')
  const [side, setSide] = useState<'for' | 'against' | null>(null)
  const [amount, setAmount] = useState('')
  const [sensitivity, setSensitivity] = useState<'low' | 'medium' | 'high'>('medium')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const sensitivityMap = {
    low: 0.25,
    medium: 0.5,
    high: 1.0,
  }

  const virtualLiquidity = Math.round(startingBalance * sensitivityMap[sensitivity])

  const quickPicks = [
    { label: '10%', value: Math.floor(userBalance * 0.1) },
    { label: '25%', value: Math.floor(userBalance * 0.25) },
    { label: '50%', value: Math.floor(userBalance * 0.5) },
  ]

  // Trade preview using AMM math
  const preview = useMemo(() => {
    if (!side || !amount || Number(amount) <= 0) return null
    const V = virtualLiquidity
    const k = V * V
    try {
      const trade = estimateTrade(
        { yesPool: V, noPool: V, k },
        side,
        Number(amount)
      )
      return trade
    } catch {
      return null
    }
  }, [side, amount, virtualLiquidity])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!side || !amount || Number(amount) <= 0) {
      setError('Please pick a side and enter a wager amount')
      return
    }
    if (Number(amount) > userBalance) {
      setError('Insufficient balance')
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/bets/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          title,
          description: description || null,
          subject_user_id: subjectUserId || null,
          resolution_method: resolutionMethod,
          deadline: deadline ? new Date(deadline).toISOString() : null,
          sensitivity,
          creator_side: side,
          creator_amount: Number(amount),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create bet')
        setLoading(false)
      } else {
        router.refresh()
        onSuccess()
      }
    } catch {
      setError('Failed to create bet')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        id="bet-title"
        label="What's the bet?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Jake will eat 5 hot dogs in 10 min"
        required
      />
      <Input
        id="bet-desc"
        label="Details (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Must be done at the BBQ this Saturday"
      />
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-[#a2a8cc]">Subject (optional)</label>
        <select
          value={subjectUserId}
          onChange={(e) => setSubjectUserId(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-[#1a2340] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#ba0963]/50"
        >
          <option value="">No subject</option>
          {members.map((m: any) => (
            <option key={m.user_id} value={m.user_id}>
              {m.profiles?.display_name || m.profiles?.username}
            </option>
          ))}
        </select>
        <p className="text-xs text-[#a2a8cc]">
          If someone is challenged, they get a bonus if they succeed (and someone else created the bet)
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-[#a2a8cc]">Resolution Method</label>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setResolutionMethod('creator')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
              resolutionMethod === 'creator'
                ? 'bg-[#ba0963] border-[#ba0963] text-white'
                : 'border-white/10 text-[#a2a8cc] hover:bg-white/5'
            }`}
          >
            Creator Decides
          </button>
          <button
            type="button"
            onClick={() => setResolutionMethod('vote')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
              resolutionMethod === 'vote'
                ? 'bg-[#ba0963] border-[#ba0963] text-white'
                : 'border-white/10 text-[#a2a8cc] hover:bg-white/5'
            }`}
          >
            Group Vote
          </button>
        </div>
      </div>
      <Input
        id="bet-deadline"
        label="Deadline (optional)"
        type="datetime-local"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
      />

      {/* Divider */}
      <div className="border-t border-white/10 pt-4">
        <h3 className="text-sm font-semibold text-white mb-3">Your Opening Position</h3>

        {/* Side picker */}
        <div className="space-y-1.5 mb-4">
          <label className="block text-sm font-medium text-[#a2a8cc]">Pick a side</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSide('for')}
              className={`py-3 rounded-lg text-sm font-semibold transition-colors border ${
                side === 'for'
                  ? 'bg-green-500/20 border-green-500 text-green-400'
                  : 'border-white/10 text-[#a2a8cc] hover:bg-white/5'
              }`}
            >
              For
            </button>
            <button
              type="button"
              onClick={() => setSide('against')}
              className={`py-3 rounded-lg text-sm font-semibold transition-colors border ${
                side === 'against'
                  ? 'bg-red-500/20 border-red-500 text-red-400'
                  : 'border-white/10 text-[#a2a8cc] hover:bg-white/5'
              }`}
            >
              Against
            </button>
          </div>
        </div>

        {/* Amount input */}
        <div className="mb-4">
          <Input
            id="bet-amount"
            label={`Wager Amount (Balance: ${userBalance.toLocaleString()})`}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min={1}
            max={userBalance}
            placeholder="Enter amount"
          />
          <div className="flex gap-2 mt-2">
            {quickPicks.map((qp) => (
              <button
                key={qp.label}
                type="button"
                onClick={() => setAmount(String(qp.value))}
                className="flex-1 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-[#a2a8cc] hover:bg-white/5 hover:text-white transition-colors"
              >
                {qp.label}
              </button>
            ))}
          </div>
        </div>

        {/* Odds sensitivity */}
        <div className="space-y-1.5 mb-4">
          <label className="block text-sm font-medium text-[#a2a8cc]">Odds Sensitivity</label>
          <div className="flex gap-3">
            {(['low', 'medium', 'high'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setSensitivity(level)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  sensitivity === level
                    ? 'bg-[#ba0963] border-[#ba0963] text-white'
                    : 'border-white/10 text-[#a2a8cc] hover:bg-white/5'
                }`}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-xs text-[#a2a8cc]">
            {sensitivity === 'low' && 'Odds swing dramatically with each wager'}
            {sensitivity === 'medium' && 'Balanced odds movement (recommended)'}
            {sensitivity === 'high' && 'Odds are stable, takes large wagers to move the needle'}
          </p>
        </div>

        {/* Trade preview */}
        {preview && side && (
          <div className="bg-[#1a2340] rounded-lg p-3 mb-4 space-y-1">
            <p className="text-xs font-medium text-[#a2a8cc]">Trade Preview</p>
            <p className="text-sm text-white">
              ~{preview.shares.toFixed(1)} shares at avg {preview.avgPrice.toFixed(2)}/share
            </p>
            <p className="text-xs text-[#a2a8cc]">
              New odds: Yes {formatProbability(preview.newYesPrice)} / No {formatProbability(preview.newNoPrice)}
            </p>
            {preview.priceImpact > 0.01 && (
              <p className="text-xs text-yellow-400">
                Price impact: {(preview.priceImpact * 100).toFixed(1)}%
              </p>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button
        type="submit"
        loading={loading}
        disabled={!title || !side || !amount || Number(amount) <= 0 || Number(amount) > userBalance}
        className="w-full"
      >
        Create Bet
      </Button>
    </form>
  )
}
