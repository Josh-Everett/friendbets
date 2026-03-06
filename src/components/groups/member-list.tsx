import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

interface MemberListProps {
  members: any[]
  currencySymbol: string
}

export function MemberList({ members, currencySymbol }: MemberListProps) {
  return (
    <div className="space-y-2">
      {members.map((m: any) => (
        <div
          key={m.id}
          className="flex items-center justify-between py-3 px-4 bg-[#1a2340] rounded-lg"
        >
          <div className="flex items-center gap-3">
            <Avatar
              name={m.profiles?.display_name || m.profiles?.username || 'User'}
              src={m.profiles?.avatar_url}
              size="sm"
            />
            <div>
              <p className="text-sm font-medium text-white">
                {m.profiles?.display_name || m.profiles?.username}
              </p>
              <p className="text-xs text-[#a2a8cc]">@{m.profiles?.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {m.role === 'admin' && <Badge variant="gold">Admin</Badge>}
            <span className="text-[#fdd160] font-semibold">
              {currencySymbol}{m.balance.toLocaleString()}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
