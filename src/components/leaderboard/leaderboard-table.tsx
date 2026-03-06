import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { Trophy } from 'lucide-react'

interface LeaderboardTableProps {
  members: any[]
  currencySymbol: string
}

const rankStyles: Record<number, string> = {
  0: 'text-[#fdd160]', // gold
  1: 'text-gray-300',   // silver
  2: 'text-amber-600',  // bronze
}

const rankIcons: Record<number, string> = {
  0: '🥇',
  1: '🥈',
  2: '🥉',
}

export function LeaderboardTable({ members, currencySymbol }: LeaderboardTableProps) {
  // Members should already be sorted by balance descending
  return (
    <div className="space-y-2">
      {members.map((m: any, index: number) => (
        <div
          key={m.id}
          className={cn(
            'flex items-center justify-between py-3 px-4 rounded-lg transition-colors',
            index < 3 ? 'bg-[#1a2340] border border-white/5' : 'bg-[#151d30]'
          )}
        >
          <div className="flex items-center gap-4">
            <div className="w-8 text-center">
              {index < 3 ? (
                <span className="text-lg">{rankIcons[index]}</span>
              ) : (
                <span className="text-sm text-[#a2a8cc] font-mono">{index + 1}</span>
              )}
            </div>
            <Avatar
              name={m.profiles?.display_name || m.profiles?.username || 'User'}
              src={m.profiles?.avatar_url}
              size="sm"
            />
            <div>
              <p className={cn('font-medium', index < 3 ? rankStyles[index] : 'text-white')}>
                {m.profiles?.display_name || m.profiles?.username}
              </p>
              <p className="text-xs text-[#a2a8cc]">@{m.profiles?.username}</p>
            </div>
          </div>
          <span className={cn(
            'font-bold text-lg',
            index < 3 ? rankStyles[index] : 'text-[#fdd160]'
          )}>
            {currencySymbol}{m.balance.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}
