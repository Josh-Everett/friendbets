// ============================================================
// Chart Data Utilities
// ============================================================
// Pure data transformation module for chart visualizations.
// No database calls, no side effects.

import { createMarket, applyTrade, getPrices, type PoolState } from '@/lib/amm'

// ── Colors ─────────────────────────────────────────────────

/** 7 distinct colors for dark backgrounds, one per user */
export const USER_COLORS = [
  '#ba0963', '#fdd160', '#60a5fa', '#34d399',
  '#f97316', '#a78bfa', '#fb7185',
]

/**
 * Returns a deterministic color for a user by sorting all user IDs
 * alphabetically and using the index into USER_COLORS.
 */
export function getUserColor(userId: string, allUserIds: string[]): string {
  const sorted = [...allUserIds].sort()
  const index = sorted.indexOf(userId)
  if (index === -1) return USER_COLORS[0]
  return USER_COLORS[index % USER_COLORS.length]
}

// ── Odds History ───────────────────────────────────────────

export interface WagerInput {
  created_at: string
  side: 'for' | 'against'
  amount: number
  shares?: number
  price_avg?: number
  profiles?: { username?: string; display_name?: string } | null
}

export interface OddsDataPoint {
  index: number
  yesPrice: number // 0-100
  label: string    // username or "Start"
  side: string
  amount: number
}

/**
 * Reconstructs odds history from wager data by replaying each trade
 * through the CPMM engine.
 *
 * Returns an array of data points showing how the probability shifted
 * after each wager, suitable for line chart rendering.
 */
export function buildOddsHistory(
  wagers: WagerInput[],
  virtualLiquidity: number,
  _betCreatedAt: string
): OddsDataPoint[] {
  let state: PoolState = createMarket(virtualLiquidity)
  const initialPrices = getPrices(state)

  const points: OddsDataPoint[] = [
    {
      index: 0,
      yesPrice: initialPrices.yesPrice * 100,
      label: 'Start',
      side: '',
      amount: 0,
    },
  ]

  if (wagers.length === 0) return points

  const sorted = [...wagers].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  for (let i = 0; i < sorted.length; i++) {
    const wager = sorted[i]
    const { newState } = applyTrade(state, wager.side, wager.amount)
    state = newState
    const prices = getPrices(state)

    const username =
      wager.profiles?.display_name ?? wager.profiles?.username ?? 'Unknown'

    points.push({
      index: i + 1,
      yesPrice: prices.yesPrice * 100,
      label: username,
      side: wager.side,
      amount: wager.amount,
    })
  }

  return points
}

// ── Wager Breakdown ────────────────────────────────────────

export interface WagerBreakdownInput {
  user_id: string
  side: string
  amount: number
  profiles?: { username?: string; display_name?: string } | null
}

export interface Segment {
  userId: string
  username: string
  amount: number
  percentage: number // 0-100
  color: string
}

export interface WagerBreakdown {
  forSegments: Segment[]
  againstSegments: Segment[]
  forTotal: number
  againstTotal: number
}

/**
 * Groups wagers by side and user, aggregating amounts for users who
 * made multiple purchases on the same side (AMM allows this).
 *
 * Returns segments with deterministic colors assigned via getUserColor.
 */
export function buildWagerBreakdown(wagers: WagerBreakdownInput[]): WagerBreakdown {
  // Aggregate amounts by user_id within each side
  const forMap = new Map<string, { username: string; amount: number }>()
  const againstMap = new Map<string, { username: string; amount: number }>()

  for (const wager of wagers) {
    const username =
      wager.profiles?.display_name ?? wager.profiles?.username ?? 'Unknown'
    const map = wager.side === 'for' ? forMap : againstMap
    const existing = map.get(wager.user_id)
    if (existing) {
      existing.amount += wager.amount
    } else {
      map.set(wager.user_id, { username, amount: wager.amount })
    }
  }

  // Collect all unique user IDs for deterministic color assignment
  const allUserIds = [
    ...new Set([...forMap.keys(), ...againstMap.keys()]),
  ]

  const forTotal = Array.from(forMap.values()).reduce((sum, v) => sum + v.amount, 0)
  const againstTotal = Array.from(againstMap.values()).reduce((sum, v) => sum + v.amount, 0)

  function toSegments(
    map: Map<string, { username: string; amount: number }>,
    total: number
  ): Segment[] {
    return Array.from(map.entries()).map(([userId, { username, amount }]) => ({
      userId,
      username,
      amount,
      percentage: total > 0 ? (amount / total) * 100 : 0,
      color: getUserColor(userId, allUserIds),
    }))
  }

  return {
    forSegments: toSegments(forMap, forTotal),
    againstSegments: toSegments(againstMap, againstTotal),
    forTotal,
    againstTotal,
  }
}
