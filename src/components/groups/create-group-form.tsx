'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CreateGroupForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [currencyName, setCurrencyName] = useState('Coins')
  const [currencySymbol, setCurrencySymbol] = useState('🪙')
  const [startingBalance, setStartingBalance] = useState(1000)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: description || null,
        currency_name: currencyName,
        currency_symbol: currencySymbol,
        starting_balance: startingBalance,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to create group')
      setLoading(false)
    } else {
      const data = await res.json()
      router.push(`/groups/${data.slug}`)
      router.refresh()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        id="group-name"
        label="Group Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="The Boys"
        required
      />
      <Input
        id="group-desc"
        label="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Our legendary betting circle"
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          id="currency-name"
          label="Currency Name"
          value={currencyName}
          onChange={(e) => setCurrencyName(e.target.value)}
          placeholder="Coins"
        />
        <Input
          id="currency-symbol"
          label="Symbol"
          value={currencySymbol}
          onChange={(e) => setCurrencySymbol(e.target.value)}
          placeholder="🪙"
        />
      </div>
      <Input
        id="starting-balance"
        label="Starting Balance"
        type="number"
        value={startingBalance}
        onChange={(e) => setStartingBalance(Number(e.target.value))}
        min={100}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" loading={loading}>
        Create Group
      </Button>
    </form>
  )
}
