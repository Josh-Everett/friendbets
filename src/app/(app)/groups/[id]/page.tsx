import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BetFeed } from '@/components/bets/bet-feed'
import { LeaderboardTable } from '@/components/leaderboard/leaderboard-table'
import { GroupSettings } from '@/components/groups/group-settings'
import { GroupHistory } from '@/components/groups/group-history'
import { AchievementsList } from '@/components/achievements/achievements-list'
import { GroupTabs } from '@/components/groups/group-tabs'
import { CopyInviteButton } from '@/components/groups/copy-invite-button'
import { BalanceHistoryChart } from '@/components/charts/balance-history-chart'

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab = 'bets' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Get group
  const { data: groupData } = await supabase
    .from('groups')
    .select('*')
    .eq('id', id)
    .single()

  if (!groupData) notFound()
  let group = groupData as any

  // Check for season reset
  if (group.season_end_at && new Date(group.season_end_at) < new Date()) {
    try {
      await (supabase.rpc as any)('reset_season', { p_group_id: id })
      // Re-fetch group data after reset
      const { data: refreshedGroup } = await supabase
        .from('groups')
        .select('*')
        .eq('id', id)
        .single()
      if (refreshedGroup) group = refreshedGroup as any
    } catch {
      // Season reset failed — continue with stale data
    }
  }

  // Verify membership
  const { data: membershipData } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', id)
    .eq('user_id', user!.id)
    .single()

  if (!membershipData) redirect('/dashboard')
  const membership = membershipData as any

  // Get all members with profiles
  const { data: membersData } = await supabase
    .from('group_members')
    .select('*, profiles(*)')
    .eq('group_id', id)
    .order('balance', { ascending: false })

  const members = (membersData ?? []) as any[]

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold text-white">{group.name}</h1>
          <CopyInviteButton groupId={id} />
        </div>
        {group.description && (
          <p className="text-[#a2a8cc] mt-1">{group.description}</p>
        )}
        <div className="flex items-center gap-4 mt-2">
          <span className="text-sm text-[#a2a8cc]">
            {members.length} members
          </span>
          <span className="text-sm text-[#fdd160] font-semibold">
            Your balance: {group.currency_symbol}{membership.balance.toLocaleString()}
          </span>
        </div>
      </div>

      <GroupTabs groupId={id} activeTab={tab} isAdmin={membership.role === 'admin'} />

      {tab === 'bets' && (
        <BetFeed
          groupId={id}
          userId={user!.id}
          members={members}
          currencySymbol={group.currency_symbol}
          userBalance={membership.balance}
          startingBalance={group.starting_balance}
        />
      )}
      {tab === 'leaderboard' && (
        <>
          <BalanceHistoryChart
            groupId={id}
            members={members}
            currencySymbol={group.currency_symbol}
            startingBalance={group.starting_balance}
          />
          <LeaderboardTable
            members={members}
            currencySymbol={group.currency_symbol}
          />
        </>
      )}
      {tab === 'history' && (
        <GroupHistory groupId={id} currencySymbol={group.currency_symbol} />
      )}
      {tab === 'achievements' && (
        <AchievementsList groupId={id} />
      )}
      {tab === 'settings' && membership.role === 'admin' && (
        <GroupSettings group={group} members={members} />
      )}
    </div>
  )
}
