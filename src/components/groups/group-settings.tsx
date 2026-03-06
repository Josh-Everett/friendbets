import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { InviteCodeDisplay } from './invite-code-display'
import { MemberList } from './member-list'
import type { Group } from '@/lib/types/app'

interface GroupSettingsProps {
  group: Group
  members: any[]
}

export function GroupSettings({ group, members }: GroupSettingsProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-white">Invite Friends</h2>
        </CardHeader>
        <CardContent>
          <InviteCodeDisplay groupId={group.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-white">Members ({members.length})</h2>
        </CardHeader>
        <CardContent>
          <MemberList members={members} currencySymbol={group.currency_symbol} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-white">Group Info</h2>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[#a2a8cc]">Currency</span>
            <span className="text-white">{group.currency_symbol} {group.currency_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#a2a8cc]">Starting Balance</span>
            <span className="text-white">{group.currency_symbol}{group.starting_balance.toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
