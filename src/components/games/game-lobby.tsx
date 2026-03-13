'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { GAMES } from '@/lib/games/registry'
import { formatCurrency } from '@/lib/utils'

interface GameLobbyProps {
  groupSlug: string
  currencySymbol: string
  pools: Record<string, { balance: number; daily_high_score: number | null; daily_high_user_id: string | null; all_time_high_score: number | null; all_time_high_user_id: string | null }>
  members: Array<{ user_id: string; profiles: { username: string; display_name: string | null } }>
}

export function GameLobby({ groupSlug, currencySymbol, pools, members }: GameLobbyProps) {
  function getUsername(userId: string | null) {
    if (!userId) return null
    const m = members.find((m) => m.user_id === userId)
    return m?.profiles?.display_name || m?.profiles?.username || null
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Games</h2>
        <p className="text-sm text-[#a2a8cc]">Play mini-games and bet on your skills</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {GAMES.map((game) => {
          const pool = pools[game.slug]
          const highScore = pool?.daily_high_score
          const holder = getUsername(pool?.daily_high_user_id ?? null)
          const allTimeHigh = pool?.all_time_high_score
          const allTimeHolder = getUsername(pool?.all_time_high_user_id ?? null)

          return (
            <Link key={game.slug} href={`/groups/${groupSlug}/games/${game.slug}`}>
              <Card className="hover:border-white/15 transition-colors cursor-pointer h-full">
                <CardContent className="py-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{game.icon}</span>
                      <div>
                        <h3 className="font-semibold text-white">{game.name}</h3>
                        <p className="text-xs text-[#a2a8cc]">{game.description}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    {pool && pool.balance > 0 && (
                      <Badge variant="gold">
                        Pool: {formatCurrency(pool.balance, currencySymbol)}
                      </Badge>
                    )}
                    {highScore != null && (
                      <span className="text-xs text-[#a2a8cc]">
                        Today: {highScore}{holder ? ` by ${holder}` : ''}
                      </span>
                    )}
                    {highScore == null && (
                      <span className="text-xs text-[#a2a8cc]">No plays today</span>
                    )}
                    {allTimeHigh != null && (
                      <span className="text-xs text-[#a2a8cc]">
                        Record: {allTimeHigh}{allTimeHolder ? ` by ${allTimeHolder}` : ''}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
