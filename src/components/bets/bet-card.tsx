import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BET_STATUS_COLORS } from '@/lib/constants'
import { formatDistanceToNow } from 'date-fns'
import { Clock } from 'lucide-react'
import { getPrices, formatProbability } from '@/lib/amm'

interface BetCardProps {
  bet: any
  groupId: string
  currencySymbol: string
}

export function BetCard({ bet, groupId, currencySymbol }: BetCardProps) {
  const creatorName = bet.profiles?.display_name || bet.profiles?.username || 'Unknown'

  const prices = bet.yes_pool && bet.no_pool && bet.k
    ? getPrices({ yesPool: Number(bet.yes_pool), noPool: Number(bet.no_pool), k: Number(bet.k) })
    : null

  return (
    <Link href={`/groups/${groupId}/bets/${bet.id}`}>
      <Card className="hover:border-white/10 transition-colors cursor-pointer">
        <CardContent className="py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-semibold text-white truncate">{bet.title}</h3>
                <Badge className={BET_STATUS_COLORS[bet.status]}>{bet.status}</Badge>
                {bet.resolution_method === 'vote' && (
                  <Badge variant="default">Vote</Badge>
                )}
              </div>
              {prices && (
                <div className="flex items-center gap-2 text-xs mt-1">
                  <span className="text-green-400">Yes {formatProbability(prices.yesPrice)}</span>
                  <span className="text-[#a2a8cc]">/</span>
                  <span className="text-red-400">No {formatProbability(prices.noPrice)}</span>
                </div>
              )}
              {bet.description && (
                <p className="text-sm text-[#a2a8cc] line-clamp-2 mb-2 mt-1">{bet.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-[#a2a8cc]">
                <span>by {creatorName}</span>
                {bet.deadline && (
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {formatDistanceToNow(new Date(bet.deadline), { addSuffix: true })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
