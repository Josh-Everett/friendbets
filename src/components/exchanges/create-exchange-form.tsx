'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface CreateExchangeFormProps {
  groupId: string
  userBalance: number
  onSuccess: () => void
}

export function CreateExchangeForm({ groupId, userBalance, onSuccess }: CreateExchangeFormProps) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reward, setReward] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const quickPicks = [
    { label: '10%', value: Math.floor(userBalance * 0.1) },
    { label: '25%', value: Math.floor(userBalance * 0.25) },
    { label: '50%', value: Math.floor(userBalance * 0.5) },
  ]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !reward || Number(reward) <= 0) {
      setError('Please enter a title and reward amount')
      return
    }
    if (Number(reward) > userBalance) {
      setError('Insufficient balance')
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/exchanges/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          title,
          description: description || null,
          reward: Number(reward),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create task')
        setLoading(false)
      } else {
        router.refresh()
        onSuccess()
      }
    } catch {
      setError('Failed to create task')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        id="exchange-title"
        label="What needs doing?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Do the dishes"
        required
      />
      <Input
        id="exchange-desc"
        label="Details (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Kitchen sink, not the bathroom"
      />
      <div>
        <Input
          id="exchange-reward"
          label={`Reward (Balance: ${userBalance.toLocaleString()})`}
          type="number"
          value={reward}
          onChange={(e) => setReward(e.target.value)}
          min={1}
          max={userBalance}
          placeholder="Enter reward amount"
        />
        <div className="flex gap-2 mt-2">
          {quickPicks.map((qp) => (
            <button
              key={qp.label}
              type="button"
              onClick={() => setReward(String(qp.value))}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg border border-white/10 text-[#a2a8cc] hover:bg-white/5 hover:text-white transition-colors"
            >
              {qp.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#a2a8cc] mt-1">
          This amount will be escrowed from your balance immediately
        </p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button
        type="submit"
        loading={loading}
        disabled={!title || !reward || Number(reward) <= 0 || Number(reward) > userBalance}
        className="w-full"
      >
        Post Task
      </Button>
    </form>
  )
}
