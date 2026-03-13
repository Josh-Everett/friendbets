'use client'

import { useEffect, useState } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BET_STATUS_COLORS } from '@/lib/constants'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'

interface GroupHistoryProps {
  groupId: string
  groupSlug: string
  currencySymbol: string
}

export function GroupHistory({ groupId, groupSlug, currencySymbol }: GroupHistoryProps) {
  const supabase = useSupabase()
  const [bets, setBets] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const PAGE_SIZE = 10

  const fetchBets = async (pageNum: number) => {
    setLoading(true)
    const { data } = await supabase
      .from('bets')
      .select('*, profiles!bets_created_by_fkey(username, display_name), bet_wagers(amount, side)')
      .eq('group_id', groupId)
      .in('status', ['resolved', 'cancelled'])
      .order('resolved_at', { ascending: false, nullsFirst: false })
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)

    if (data) {
      setBets((prev) => (pageNum === 0 ? data : [...prev, ...data]))
      setHasMore(data.length === PAGE_SIZE)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchBets(0)
  }, [groupId])

  const loadMore = () => {
    const next = page + 1
    setPage(next)
    fetchBets(next)
  }

  if (!loading && bets.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-[#a2a8cc]">No resolved bets yet</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {bets.map((bet: any) => {
        const totalPool = bet.bet_wagers?.reduce((s: number, w: any) => s + w.amount, 0) ?? 0
        return (
          <Link key={bet.id} href={`/groups/${groupSlug}/bets/${bet.short_id}`}>
            <Card className="hover:border-white/10 transition-colors cursor-pointer">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-white">{bet.title}</h3>
                      <Badge className={BET_STATUS_COLORS[bet.status]}>
                        {bet.status}
                      </Badge>
                      {bet.outcome !== null && (
                        <Badge variant={bet.outcome ? 'success' : 'danger'}>
                          {bet.outcome ? 'Happened' : "Didn't happen"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-[#a2a8cc]">
                      by {bet.profiles?.display_name || bet.profiles?.username} • {bet.resolved_at ? formatDistanceToNow(new Date(bet.resolved_at), { addSuffix: true }) : ''}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[#fdd160]">
                    {currencySymbol}{totalPool.toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        )
      })}
      {hasMore && (
        <div className="text-center pt-2">
          <Button variant="ghost" onClick={loadMore} loading={loading}>
            Load More
          </Button>
        </div>
      )}
    </div>
  )
}
