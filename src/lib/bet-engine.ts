import type { BetWager } from '@/lib/types/app'
import type { OddsInfo } from '@/lib/types/app'
import { getPrices, estimatePayout as ammEstimatePayout, formatOdds, formatProbability } from '@/lib/amm'
import type { PoolState } from '@/lib/amm'

export interface MarketState {
  yesPool: number
  noPool: number
  k: number
  totalPot: number
  totalYesShares: number
  totalNoShares: number
}

export interface ResolutionResult {
  payouts: Map<string, number>  // userId -> payout amount
  subjectBonusUserId: string | null
  subjectBonusAmount: number
  totalPot: number
}

/** Build market state from bet data and wagers */
export function getMarketState(bet: any, wagers: any[]): MarketState {
  const totalPot = wagers.reduce((sum: number, w: any) => sum + (w.amount || 0), 0)
  const totalYesShares = wagers
    .filter((w: any) => w.side === 'for')
    .reduce((sum: number, w: any) => sum + (w.shares || 0), 0)
  const totalNoShares = wagers
    .filter((w: any) => w.side === 'against')
    .reduce((sum: number, w: any) => sum + (w.shares || 0), 0)

  return {
    yesPool: bet.yes_pool ?? 500,
    noPool: bet.no_pool ?? 500,
    k: bet.k ?? 250000,
    totalPot,
    totalYesShares,
    totalNoShares,
  }
}

/** Get display-ready odds info for a bet */
export function getBetOdds(bet: any): OddsInfo {
  const state: PoolState = {
    yesPool: bet.yes_pool ?? 500,
    noPool: bet.no_pool ?? 500,
    k: bet.k ?? 250000,
  }
  const prices = getPrices(state)

  return {
    yesPrice: prices.yesPrice,
    noPrice: prices.noPrice,
    yesOdds: formatOdds(prices.yesPrice),
    noOdds: formatOdds(prices.noPrice),
    yesProbability: formatProbability(prices.yesPrice),
    noProbability: formatProbability(prices.noPrice),
  }
}

/**
 * Calculate resolution payouts (for preview display).
 *
 * Aggregates shares per user (there may be multiple wager rows per user
 * since we allow multiple purchases). Then:
 *   payout = (userTotalShares / totalWinningShares) * totalPot
 */
export function calculateResolution(
  wagers: any[],
  outcome: boolean,
  subjectUserId: string | null,
  createdBy: string,
  yesPool: number,
  noPool: number,
  k: number
): ResolutionResult {
  const winningSide = outcome ? 'for' : 'against'
  const totalPot = wagers.reduce((sum: number, w: any) => sum + (w.amount || 0), 0)

  // Aggregate shares per user on the winning side
  const winnerSharesByUser = new Map<string, number>()
  let totalWinningShares = 0

  for (const w of wagers) {
    if (w.side === winningSide) {
      const shares = w.shares || 0
      const existing = winnerSharesByUser.get(w.user_id) || 0
      winnerSharesByUser.set(w.user_id, existing + shares)
      totalWinningShares += shares
    }
  }

  // Calculate payouts
  const payouts = new Map<string, number>()

  for (const [userId, userShares] of winnerSharesByUser) {
    const payout = ammEstimatePayout(userShares, totalWinningShares, totalPot)
    payouts.set(userId, Math.floor(payout))
  }

  // Subject bonus: subject gets FULL POT if they succeed AND someone else created the bet
  let subjectBonusUserId: string | null = null
  let subjectBonusAmount = 0

  if (subjectUserId && outcome && subjectUserId !== createdBy) {
    subjectBonusUserId = subjectUserId
    subjectBonusAmount = totalPot
  }

  return { payouts, subjectBonusUserId, subjectBonusAmount, totalPot }
}

/** Keep the old getOddsDisplay signature but implement with AMM prices */
export function getOddsDisplay(yesPool: number, noPool: number): string {
  const total = yesPool + noPool
  if (total <= 0) return 'No wagers yet'

  const yesPrice = noPool / total
  const noPrice = yesPool / total

  const yesPct = formatProbability(yesPrice)
  const noPct = formatProbability(noPrice)

  return `For ${yesPct} / Against ${noPct}`
}
