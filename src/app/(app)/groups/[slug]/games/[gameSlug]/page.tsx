import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getGameBySlug } from '@/lib/games/registry'
import { GamePage } from './game-page'

export default async function GamePageServer({
  params,
}: {
  params: Promise<{ slug: string; gameSlug: string }>
}) {
  const { slug, gameSlug } = await params
  const game = getGameBySlug(gameSlug)
  if (!game) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Get group
  const { data: groupData } = await supabase
    .from('groups')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!groupData) notFound()
  const group = groupData as any

  // Verify membership
  const { data: membershipData } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', group.id)
    .eq('user_id', user.id)
    .single()

  if (!membershipData) redirect('/dashboard')
  const membership = membershipData as any

  // Get game pool
  const { data: poolData } = await supabase
    .from('game_pools')
    .select('*')
    .eq('group_id', group.id)
    .eq('game_type', gameSlug)
    .single() as { data: any }

  // Check for daily reset on pool data
  let dailyHigh: number | null = null
  let dailyHighUserId: string | null = null
  let poolBalance = 0

  if (poolData) {
    const resetAt = new Date(poolData.daily_reset_at)
    if (resetAt <= new Date()) {
      // Pool needs daily reset — high score is stale
      dailyHigh = null
      dailyHighUserId = null
    } else {
      dailyHigh = poolData.daily_high_score
      dailyHighUserId = poolData.daily_high_user_id
    }
    poolBalance = poolData.balance
  }

  // Get username for high score holder
  let dailyHighUser: string | null = null
  if (dailyHighUserId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username, display_name')
      .eq('id', dailyHighUserId)
      .single() as { data: any }

    if (profile) {
      dailyHighUser = profile.display_name || profile.username
    }
  }

  // Get today's plays for this game in this group
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  const { data: todayPlays } = await supabase
    .from('game_plays')
    .select('*, profiles(*)')
    .eq('group_id', group.id)
    .eq('game_type', gameSlug)
    .gte('created_at', todayStart.toISOString())
    .order('score', { ascending: false })
    .limit(20) as { data: any[] }

  return (
    <GamePage
      groupId={group.id}
      groupSlug={slug}
      gameSlug={gameSlug}
      gameName={game.name}
      gameIcon={game.icon}
      userId={user.id}
      userBalance={membership.balance}
      currencySymbol={group.currency_symbol}
      dailyHigh={dailyHigh}
      dailyHighUser={dailyHighUser}
      prizePool={poolBalance}
      todayPlays={todayPlays ?? []}
    />
  )
}
