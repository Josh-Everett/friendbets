'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { ExchangeCard } from './exchange-card'
import { CreateExchangeForm } from './create-exchange-form'
import { useSupabase } from '@/hooks/use-supabase'

interface ExchangeFeedProps {
  groupId: string
  userId: string
  currencySymbol: string
  userBalance: number
}

export function ExchangeFeed({ groupId, userId, currencySymbol, userBalance }: ExchangeFeedProps) {
  const supabase = useSupabase()
  const [exchanges, setExchanges] = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchExchanges = useCallback(async () => {
    const { data } = await supabase
      .from('exchanges')
      .select('*, profiles:created_by(*), claimer:claimed_by(*)')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false }) as { data: any }

    setExchanges(data ?? [])
    setLoading(false)
  }, [supabase, groupId])

  useEffect(() => {
    fetchExchanges()
  }, [fetchExchanges])

  const activeExchanges = exchanges.filter((e) => e.status === 'open' || e.status === 'claimed')

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-[#a2a8cc]">Loading...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus size={16} />
          New Task
        </Button>
      </div>

      {activeExchanges.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-[#a2a8cc] mb-4">No active tasks</p>
            <Button onClick={() => setShowCreate(true)}>Post the first task</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activeExchanges.map((exchange) => (
            <ExchangeCard
              key={exchange.id}
              exchange={exchange}
              userId={userId}
              currencySymbol={currencySymbol}
              onAction={fetchExchanges}
            />
          ))}
        </div>
      )}

      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="Post a New Task">
        <CreateExchangeForm
          groupId={groupId}
          userBalance={userBalance}
          onSuccess={() => { setShowCreate(false); fetchExchanges() }}
        />
      </Dialog>
    </div>
  )
}
