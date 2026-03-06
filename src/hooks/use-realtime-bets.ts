'use client'

import { useEffect, useState } from 'react'
import { useSupabase } from './use-supabase'
import type { Bet, BetWager } from '@/lib/types/app'

export function useRealtimeBets(groupId: string) {
  const supabase = useSupabase()
  const [bets, setBets] = useState<Bet[]>([])

  useEffect(() => {
    // Initial fetch
    const fetchBets = async () => {
      const { data } = await supabase
        .from('bets')
        .select('*, profiles!bets_created_by_fkey(*)')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
      if (data) setBets(data as Bet[])
    }

    fetchBets()

    // Subscribe to changes
    const channel = supabase
      .channel(`bets:${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bets', filter: `group_id=eq.${groupId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setBets((prev) => [payload.new as Bet, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            setBets((prev) =>
              prev.map((b) => (b.id === (payload.new as Bet).id ? (payload.new as Bet) : b))
            )
          } else if (payload.eventType === 'DELETE') {
            setBets((prev) => prev.filter((b) => b.id !== (payload.old as Bet).id))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, groupId])

  return bets
}

export function useRealtimeWagers(betId: string) {
  const supabase = useSupabase()
  const [wagers, setWagers] = useState<BetWager[]>([])

  useEffect(() => {
    const fetchWagers = async () => {
      const { data } = await supabase
        .from('bet_wagers')
        .select('*, profiles(*)')
        .eq('bet_id', betId)
        .order('created_at', { ascending: true })
      if (data) setWagers(data as BetWager[])
    }

    fetchWagers()

    const channel = supabase
      .channel(`wagers:${betId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bet_wagers', filter: `bet_id=eq.${betId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setWagers((prev) => [...prev, payload.new as BetWager])
          } else if (payload.eventType === 'UPDATE') {
            setWagers((prev) =>
              prev.map((w) => (w.id === (payload.new as BetWager).id ? (payload.new as BetWager) : w))
            )
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, betId])

  return wagers
}
