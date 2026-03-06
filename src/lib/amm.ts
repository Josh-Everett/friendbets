// ============================================================
// CPMM (Constant Product Market Maker) Math
// ============================================================
// yes_pool * no_pool = k (invariant)
// Price of Yes = no_pool / (yes_pool + no_pool)
// Price of No = yes_pool / (yes_pool + no_pool)
//
// Pure math module — no database calls, no side effects.
// Used by both client components (trade preview) and server
// components (display).

export interface PoolState {
  yesPool: number
  noPool: number
  k: number
}

export interface PriceInfo {
  yesPrice: number  // 0.0 to 1.0
  noPrice: number   // 0.0 to 1.0
}

export interface TradeEstimate {
  shares: number
  avgPrice: number       // price per share for this trade
  priceImpact: number    // percentage change in price (0.0 to 1.0)
  newYesPrice: number
  newNoPrice: number
}

// ── Pricing ──────────────────────────────────────────────────

/** Get current prices from pool state */
export function getPrices(state: PoolState): PriceInfo {
  const total = state.yesPool + state.noPool
  if (total <= 0) return { yesPrice: 0.5, noPrice: 0.5 }
  return {
    yesPrice: state.noPool / total,
    noPrice: state.yesPool / total,
  }
}

// ── Display Formatting ───────────────────────────────────────

/** Format price as odds string: "3.2:1" or "Even" */
export function formatOdds(price: number): string {
  if (price >= 0.99) return '1:100+'
  if (price <= 0.01) return '100:1+'
  if (Math.abs(price - 0.5) < 0.02) return 'Even'
  if (price > 0.5) {
    const ratio = (1 - price) / price
    return `1:${ratio.toFixed(1)}`
  }
  const ratio = (1 - price) / price
  return `${ratio.toFixed(1)}:1`
}

/** Format price as percentage: "31.2%" */
export function formatProbability(price: number): string {
  return `${(price * 100).toFixed(1)}%`
}

/** Format price as decimal odds: "4.20x" */
export function formatDecimalOdds(price: number): string {
  if (price <= 0) return '---'
  const decimal = 1 / price
  return `${decimal.toFixed(2)}x`
}

// ── Trade Estimation ─────────────────────────────────────────

/** Estimate shares received for a trade (without executing) */
export function estimateTrade(
  state: PoolState,
  side: 'for' | 'against',
  amount: number
): TradeEstimate {
  if (amount <= 0) {
    const prices = getPrices(state)
    return {
      shares: 0,
      avgPrice: 0,
      priceImpact: 0,
      newYesPrice: prices.yesPrice,
      newNoPrice: prices.noPrice,
    }
  }

  const oldPrices = getPrices(state)

  let newYesPool: number
  let newNoPool: number
  let shares: number

  if (side === 'for') {
    // Buying Yes: coins go into no_pool, shares come from yes_pool
    newNoPool = state.noPool + amount
    newYesPool = state.k / newNoPool
    shares = state.yesPool - newYesPool
  } else {
    // Buying No: coins go into yes_pool, shares come from no_pool
    newYesPool = state.yesPool + amount
    newNoPool = state.k / newYesPool
    shares = state.noPool - newNoPool
  }

  const newTotal = newYesPool + newNoPool
  const newYesPrice = newNoPool / newTotal
  const newNoPrice = newYesPool / newTotal

  const avgPrice = shares > 0 ? amount / shares : 0
  const priceImpact = oldPrices.yesPrice > 0
    ? Math.abs(newYesPrice - oldPrices.yesPrice) / oldPrices.yesPrice
    : 0

  return {
    shares,
    avgPrice,
    priceImpact,
    newYesPrice,
    newNoPrice,
  }
}

// ── Payout Estimation ────────────────────────────────────────

/**
 * Estimate payout if a side wins, given shares and current pot/shares totals.
 * Returns the raw payout amount. Caller handles profit math.
 */
export function estimatePayout(
  userShares: number,
  totalWinningShares: number,
  totalPot: number
): number {
  if (totalWinningShares <= 0) return 0
  return (userShares / totalWinningShares) * totalPot
}

// ── Pool Simulation ──────────────────────────────────────────

/** Calculate new pool state after a trade (used for simulation/preview) */
export function applyTrade(
  state: PoolState,
  side: 'for' | 'against',
  amount: number
): { newState: PoolState; shares: number } {
  if (amount <= 0) {
    return { newState: { ...state }, shares: 0 }
  }

  let newYesPool: number
  let newNoPool: number
  let shares: number

  if (side === 'for') {
    newNoPool = state.noPool + amount
    newYesPool = state.k / newNoPool
    shares = state.yesPool - newYesPool
  } else {
    newYesPool = state.yesPool + amount
    newNoPool = state.k / newYesPool
    shares = state.noPool - newNoPool
  }

  return {
    newState: {
      yesPool: newYesPool,
      noPool: newNoPool,
      k: state.k,
    },
    shares,
  }
}

// ── Market Creation ──────────────────────────────────────────

/** Initialize a new market with virtual liquidity */
export function createMarket(virtualLiquidity: number): PoolState {
  return {
    yesPool: virtualLiquidity,
    noPool: virtualLiquidity,
    k: virtualLiquidity * virtualLiquidity,
  }
}

/** Get the virtual liquidity label for a sensitivity level */
export function getSensitivityLabel(
  virtualLiquidity: number,
  startingBalance: number
): string {
  if (startingBalance <= 0) return 'Medium'
  const ratio = virtualLiquidity / startingBalance
  if (ratio <= 0.25) return 'Low'
  if (ratio >= 0.75) return 'High'
  return 'Medium'
}
