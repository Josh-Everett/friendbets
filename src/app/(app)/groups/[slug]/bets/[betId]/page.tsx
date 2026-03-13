import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { BET_STATUS_COLORS } from '@/lib/constants'
import { formatDistanceToNow } from 'date-fns'
import { WagerSection } from '@/components/bets/wager-section'
import { ResolutionPanel } from '@/components/bets/resolution-panel'
import { ProofGallery } from '@/components/bets/proof-gallery'
import { getPrices, formatOdds, formatProbability, estimatePayout } from '@/lib/amm'
import { OddsChart } from '@/components/charts/odds-chart'
import { WagerBreakdownBar } from '@/components/charts/wager-breakdown-bar'

export async function generateMetadata({ params }: { params: Promise<{ slug: string; betId: string }> }): Promise<Metadata> {
  const { slug, betId } = await params
  const supabase = await createClient()

  // Look up group to get group_id for short_id scoping
  const { data: metaGroup } = await supabase
    .from('groups')
    .select('id')
    .eq('slug', slug)
    .single() as { data: any }

  if (!metaGroup) return { title: 'Bet' }

  const { data: bet } = await supabase
    .from('bets')
    .select('title, description, status, bet_wagers(amount, side)')
    .eq('group_id', metaGroup.id)
    .eq('short_id', betId)
    .single() as { data: any }

  if (!bet) return { title: 'Bet' }

  const totalFor = bet.bet_wagers?.filter((w: any) => w.side === 'for').reduce((s: number, w: any) => s + w.amount, 0) ?? 0
  const totalAgainst = bet.bet_wagers?.filter((w: any) => w.side === 'against').reduce((s: number, w: any) => s + w.amount, 0) ?? 0
  const totalPool = totalFor + totalAgainst

  const title = bet.title
  const description = totalPool > 0
    ? `${bet.status.toUpperCase()} - Pool: ${totalPool.toLocaleString()} | For: ${totalFor.toLocaleString()} vs Against: ${totalAgainst.toLocaleString()}`
    : `${bet.status.toUpperCase()} - ${bet.description || 'Place your wager!'}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function BetDetailPage({
  params,
}: {
  params: Promise<{ slug: string; betId: string }>
}) {
  const { slug, betId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Get group by slug
  const { data: groupData } = await supabase
    .from('groups')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!groupData) notFound()
  const group = groupData as any
  const groupId = group.id

  // Verify membership
  const { data: membershipData } = await supabase
    .from('group_members')
    .select('*')
    .eq('group_id', groupId)
    .eq('user_id', user!.id)
    .single()

  if (!membershipData) redirect('/dashboard')
  const membership = membershipData as any

  // Get bet with all related data (look up by short_id within group)
  const { data: betData } = await supabase
    .from('bets')
    .select(`
      *,
      profiles!bets_created_by_fkey(*),
      bet_wagers(*, profiles(*)),
      bet_votes(*),
      bet_proofs(*)
    `)
    .eq('group_id', groupId)
    .eq('short_id', betId)
    .single()

  if (!betData) notFound()
  const bet = betData as any

  // Get subject profile if exists
  let subjectProfile: any = null
  if (bet.subject_user_id) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', bet.subject_user_id)
      .single()
    subjectProfile = data
  }

  // Get all group members for vote resolution
  const { data: membersData } = await supabase
    .from('group_members')
    .select('*, profiles(*)')
    .eq('group_id', groupId)
  const members = (membersData ?? []) as any[]

  // AMM calculations
  const prices = bet.yes_pool && bet.no_pool && bet.k
    ? getPrices({ yesPool: Number(bet.yes_pool), noPool: Number(bet.no_pool), k: Number(bet.k) })
    : null

  const forWagers = bet.bet_wagers?.filter((w: any) => w.side === 'for') ?? []
  const againstWagers = bet.bet_wagers?.filter((w: any) => w.side === 'against') ?? []
  const totalFor = forWagers.reduce((s: number, w: any) => s + w.amount, 0)
  const totalAgainst = againstWagers.reduce((s: number, w: any) => s + w.amount, 0)
  const totalPool = totalFor + totalAgainst
  const totalYesShares = forWagers.reduce((s: number, w: any) => s + Number(w.shares), 0)
  const totalNoShares = againstWagers.reduce((s: number, w: any) => s + Number(w.shares), 0)

  // User position aggregation
  const userWagers = bet.bet_wagers?.filter((w: any) => w.user_id === user!.id) ?? []
  const userSide = userWagers.length > 0 ? userWagers[0]?.side : null
  const userTotalAmount = userWagers.reduce((s: number, w: any) => s + w.amount, 0)
  const userTotalShares = userWagers.reduce((s: number, w: any) => s + Number(w.shares), 0)
  const userAvgPrice = userTotalShares > 0 ? userTotalAmount / userTotalShares : 0
  const userEstPayout = userTotalShares > 0
    ? estimatePayout(
        userTotalShares,
        userSide === 'for' ? totalYesShares : totalNoShares,
        totalPool
      )
    : 0

  const userVote = bet.bet_votes?.find((v: any) => v.user_id === user!.id)
  const isCreator = bet.created_by === user!.id
  const isAdmin = membership.role === 'admin'

  const creatorName = bet.profiles?.display_name || bet.profiles?.username || 'Unknown'
  const currencySymbol = group?.currency_symbol ?? '$'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Back link */}
      <a href={`/groups/${slug}`} className="text-sm text-[#a2a8cc] hover:text-white">
        &larr; Back to bets
      </a>

      {/* Bet Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="text-xl font-bold text-white">{bet.title}</h1>
            <Badge className={BET_STATUS_COLORS[bet.status]}>{bet.status}</Badge>
          </div>
          {bet.description && (
            <p className="text-[#a2a8cc] mb-4">{bet.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-4 text-sm text-[#a2a8cc]">
            <div className="flex items-center gap-2">
              <Avatar name={creatorName} size="sm" />
              <span>Created by {creatorName}</span>
            </div>
            {subjectProfile && (
              <div className="flex items-center gap-2">
                <span>Subject:</span>
                <Avatar name={subjectProfile.display_name || subjectProfile.username} size="sm" />
                <span className="text-[#fdd160]">
                  {subjectProfile.display_name || subjectProfile.username}
                </span>
              </div>
            )}
            {bet.deadline && (
              <span>Deadline: {formatDistanceToNow(new Date(bet.deadline), { addSuffix: true })}</span>
            )}
            <span>Method: {bet.resolution_method === 'creator' ? 'Creator decides' : 'Group vote'}</span>
          </div>
        </CardContent>
      </Card>

      {/* Live Odds + Wager Visualization */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Market</h2>
            <span className="text-sm text-[#fdd160] font-semibold">
              Pool: {currencySymbol}{totalPool.toLocaleString()}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {/* Live Odds Display */}
          {prices && (
            <div className="text-center mb-4">
              <div className="flex items-center justify-center gap-4 text-2xl font-bold">
                <span className="text-green-400">Yes {formatProbability(prices.yesPrice)}</span>
                <span className="text-[#a2a8cc] text-lg">&mdash;</span>
                <span className="text-red-400">No {formatProbability(prices.noPrice)}</span>
              </div>
              <p className="text-xs text-[#a2a8cc] mt-1">
                Yes odds: {formatOdds(prices.yesPrice)} &middot; No odds: {formatOdds(prices.noPrice)}
              </p>
            </div>
          )}

          {/* Pool bar */}
          {prices && (
            <div className="mb-4">
              <div className="flex justify-between text-xs text-[#a2a8cc] mb-1">
                <span>For ({currencySymbol}{totalFor.toLocaleString()})</span>
                <span>Against ({currencySymbol}{totalAgainst.toLocaleString()})</span>
              </div>
              <div className="h-3 rounded-full bg-[#1a2340] overflow-hidden flex">
                <div
                  className="bg-green-500 transition-all"
                  style={{ width: `${prices.yesPrice * 100}%` }}
                />
                <div
                  className="bg-red-500 transition-all"
                  style={{ width: `${prices.noPrice * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Fallback pool bar for bets without AMM data */}
          {!prices && totalPool > 0 && (
            <div className="mb-4">
              <div className="flex justify-between text-xs text-[#a2a8cc] mb-1">
                <span>For ({currencySymbol}{totalFor.toLocaleString()})</span>
                <span>Against ({currencySymbol}{totalAgainst.toLocaleString()})</span>
              </div>
              <div className="h-3 rounded-full bg-[#1a2340] overflow-hidden flex">
                <div
                  className="bg-green-500 transition-all"
                  style={{ width: `${totalPool > 0 ? (totalFor / totalPool) * 100 : 50}%` }}
                />
                <div
                  className="bg-red-500 transition-all"
                  style={{ width: `${totalPool > 0 ? (totalAgainst / totalPool) * 100 : 50}%` }}
                />
              </div>
            </div>
          )}

          {/* Odds Chart */}
          {bet.bet_wagers?.length > 0 && (
            <div className="mb-4">
              <OddsChart
                wagers={bet.bet_wagers}
                virtualLiquidity={Number(bet.virtual_liquidity)}
                betCreatedAt={bet.created_at}
                status={bet.status}
              />
            </div>
          )}

          {/* Wager Breakdown */}
          {totalPool > 0 && (
            <div className="mb-4">
              <WagerBreakdownBar
                wagers={bet.bet_wagers}
                currencySymbol={currencySymbol}
              />
            </div>
          )}

          {/* Wager lists */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium text-green-400 mb-2">For ({forWagers.length})</h3>
              {forWagers.length === 0 ? (
                <p className="text-xs text-[#a2a8cc]">No wagers yet</p>
              ) : (
                <div className="space-y-2">
                  {forWagers.map((w: any) => (
                    <div key={w.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Avatar name={w.profiles?.display_name || w.profiles?.username || 'User'} size="sm" />
                        <span className="text-white">{w.profiles?.display_name || w.profiles?.username}</span>
                      </div>
                      <span className="text-green-400 font-medium text-xs">
                        {w.shares != null
                          ? `${currencySymbol}${w.amount.toLocaleString()} → ${Number(w.shares).toFixed(1)} @ ${Number(w.price_avg).toFixed(2)}`
                          : `${currencySymbol}${w.amount.toLocaleString()}`
                        }
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-red-400 mb-2">Against ({againstWagers.length})</h3>
              {againstWagers.length === 0 ? (
                <p className="text-xs text-[#a2a8cc]">No wagers yet</p>
              ) : (
                <div className="space-y-2">
                  {againstWagers.map((w: any) => (
                    <div key={w.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Avatar name={w.profiles?.display_name || w.profiles?.username || 'User'} size="sm" />
                        <span className="text-white">{w.profiles?.display_name || w.profiles?.username}</span>
                      </div>
                      <span className="text-red-400 font-medium text-xs">
                        {w.shares != null
                          ? `${currencySymbol}${w.amount.toLocaleString()} → ${Number(w.shares).toFixed(1)} @ ${Number(w.price_avg).toFixed(2)}`
                          : `${currencySymbol}${w.amount.toLocaleString()}`
                        }
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Your Position */}
      {userWagers.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <h3 className="text-sm font-medium text-[#a2a8cc] mb-2">Your Position</h3>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className={userSide === 'for' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                {userSide === 'for' ? 'For' : 'Against'}
              </span>
              <span className="text-white">
                {currencySymbol}{userTotalAmount.toLocaleString()} invested
              </span>
              <span className="text-white">
                {userTotalShares.toFixed(1)} shares
              </span>
              <span className="text-[#a2a8cc]">
                avg {userAvgPrice.toFixed(2)}/share
              </span>
              {bet.status !== 'resolved' && bet.status !== 'cancelled' && (
                <span className="text-[#fdd160] font-semibold">
                  Est. payout: {currencySymbol}{Math.floor(userEstPayout).toLocaleString()}
                </span>
              )}
              {userWagers.some((w: any) => w.payout !== null) && (
                <span className="text-[#fdd160] font-semibold">
                  Payout: {currencySymbol}{userWagers.reduce((s: number, w: any) => s + (w.payout ?? 0), 0).toLocaleString()}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Wager Form (if bet is open) */}
      {bet.status === 'open' && prices && (
        <WagerSection
          betId={bet.id}
          groupId={groupId}
          userId={user!.id}
          userBalance={membership.balance}
          currencySymbol={currencySymbol}
          yesPool={Number(bet.yes_pool)}
          noPool={Number(bet.no_pool)}
          k={Number(bet.k)}
          totalPot={totalPool}
          totalYesShares={totalYesShares}
          totalNoShares={totalNoShares}
          existingSide={userSide}
          existingShares={userTotalShares}
        />
      )}

      {/* Fallback wager form for bets without AMM data */}
      {bet.status === 'open' && !prices && !userWagers.length && (
        <WagerSection
          betId={bet.id}
          groupId={groupId}
          userId={user!.id}
          userBalance={membership.balance}
          currencySymbol={currencySymbol}
          yesPool={500}
          noPool={500}
          k={250000}
          totalPot={totalPool}
          totalYesShares={totalYesShares}
          totalNoShares={totalNoShares}
          existingSide={null}
          existingShares={0}
        />
      )}

      {/* Resolution */}
      {(bet.status === 'open' || bet.status === 'locked') && (isCreator || isAdmin) && (
        <ResolutionPanel
          bet={bet}
          userId={user!.id}
          isCreator={isCreator}
          userVote={userVote}
          members={members ?? []}
          groupId={groupId}
        />
      )}

      {/* Outcome display */}
      {bet.status === 'resolved' && (
        <Card className="border-[#fdd160]/20">
          <CardContent className="py-4 text-center">
            <p className="text-lg font-bold text-[#fdd160]">
              {bet.outcome ? 'It happened!' : 'It didn\'t happen'}
            </p>
            {bet.subject_user_id && bet.outcome && bet.subject_user_id !== bet.created_by && (
              <p className="text-sm text-[#fdd160] mt-1">
                {subjectProfile?.display_name || subjectProfile?.username} earned the subject bonus: {currencySymbol}{totalPool.toLocaleString()}!
              </p>
            )}
            {/* Show payouts */}
            {bet.bet_wagers && bet.bet_wagers.some((w: any) => w.payout !== null && w.payout > 0) && (
              <div className="mt-4 space-y-1">
                <p className="text-xs text-[#a2a8cc] mb-2">Payouts</p>
                {bet.bet_wagers
                  .filter((w: any) => w.payout !== null && w.payout > 0)
                  .map((w: any) => (
                    <div key={w.id} className="flex items-center justify-center gap-2 text-sm">
                      <span className="text-white">
                        {w.profiles?.display_name || w.profiles?.username}
                      </span>
                      <span className="text-[#fdd160] font-semibold">
                        {currencySymbol}{w.payout.toLocaleString()}
                      </span>
                      {w.shares != null && (
                        <span className="text-xs text-[#a2a8cc]">
                          ({Number(w.shares).toFixed(1)} shares)
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Proofs */}
      <ProofGallery
        betId={bet.id}
        groupId={groupId}
        proofs={bet.bet_proofs ?? []}
        canUpload={bet.status !== 'cancelled'}
      />
    </div>
  )
}
