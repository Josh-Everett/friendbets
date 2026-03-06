# Market Making Plan — Dynamic Odds via CPMM

## Summary

Replace the current fixed-stake pool-split payout system with a **Constant Product Market Maker (CPMM)** that provides dynamic odds. Users buy "shares" on a side, and the price (odds) shifts after each purchase. Early bettors get better odds. The bet creator is the first bettor (first-mover advantage is their incentive).

**Key decisions already made:**
- AMM type: CPMM (constant product, `yes_pool * no_pool = k`)
- Liquidity: Virtual (no LP risk, just a curve-shaping parameter)
- Creator role: First bettor, picks a side + stakes coins at opening odds
- Early cashout: Not allowed — positions are locked until resolution
- Multiple purchases: Allowed on the same side, not allowed to switch sides

---

## How It Works

### The AMM State

Each bet has two virtual pools: `yes_pool` and `no_pool`, initialized to a `virtual_liquidity` value `V`. The invariant is:

```
yes_pool * no_pool = k = V²
```

### Prices

```
price_yes = no_pool / (yes_pool + no_pool)
price_no  = yes_pool / (yes_pool + no_pool)
```

Prices always sum to 1.0. A price of 0.25 means 4:1 odds (25% implied probability).

### Buying Shares

**Buying Yes shares with `A` coins:**
```
no_pool'  = no_pool + A
yes_pool' = k / no_pool'
shares    = yes_pool - yes_pool'
```

**Buying No shares with `A` coins:**
```
yes_pool' = yes_pool + A
no_pool'  = k / yes_pool'
shares    = no_pool - no_pool'
```

Each purchase moves the price — buying Yes makes Yes more expensive (worse odds) and No cheaper (better odds).

### Resolution

Total pot = sum of all real wager amounts. No virtual money is paid out.

```
payout_per_share = total_pot / total_winning_shares
user_payout = user_shares * payout_per_share
```

Losers get nothing. Winners split the entire pot proportionally to their shares.

### Virtual Liquidity Parameter

Controls price sensitivity:
- **Low V (e.g., 100):** Small bets cause big price swings. A 50-coin bet could move odds from 50% to 80%.
- **High V (e.g., 2000):** Odds are sticky. Takes large bets to move the needle.

Rule of thumb: set V ≈ 50% of `starting_balance` for the group. A group with 1000 starting balance → V = 500 default.

---

## Worked Example

V = 500, k = 250,000. Starting odds: 50/50.

| # | Who | Side | Amount | Shares | Avg Price | Yes Price After |
|---|-----|------|--------|--------|-----------|-----------------|
| 1 | Creator | No | 100 | 83.3 | 0.60 | 41% |
| 2 | Alice | Yes | 50 | 64.3 | 0.78 | 47% |
| 3 | Bob | Yes | 80 | 78.4 | 1.02 | 54% |
| 4 | Carol | No | 60 | 63.4 | 0.95 | 48% |

Total pot: 290 coins. Total Yes shares: 142.7. Total No shares: 146.7.

**If Yes wins:** Alice gets 131, Bob gets 159. Creator and Carol get 0.
**If No wins:** Creator gets 165, Carol gets 125. Alice and Bob get 0.

Alice bet earlier than Bob on the same side and got better odds (0.78 vs 1.02 per share).

---

## Database Changes

### Migration: `003_amm_market_making.sql`

#### ALTER `bets` table

```sql
-- AMM state columns
ALTER TABLE public.bets ADD COLUMN virtual_liquidity integer NOT NULL DEFAULT 500;
ALTER TABLE public.bets ADD COLUMN yes_pool numeric NOT NULL DEFAULT 500;
ALTER TABLE public.bets ADD COLUMN no_pool numeric NOT NULL DEFAULT 500;
ALTER TABLE public.bets ADD COLUMN k numeric NOT NULL DEFAULT 250000;

-- Creator's initial position (required to create a bet)
ALTER TABLE public.bets ADD COLUMN creator_side text CHECK (creator_side IN ('for', 'against'));
ALTER TABLE public.bets ADD COLUMN creator_wager_amount integer CHECK (creator_wager_amount > 0);
```

#### ALTER `bet_wagers` table

```sql
-- Shares received for this purchase
ALTER TABLE public.bet_wagers ADD COLUMN shares numeric NOT NULL DEFAULT 0;

-- Average price per share at time of purchase
ALTER TABLE public.bet_wagers ADD COLUMN price_avg numeric NOT NULL DEFAULT 0;

-- Allow multiple purchases per user per bet (on the same side)
ALTER TABLE public.bet_wagers DROP CONSTRAINT bet_wagers_bet_id_user_id_key;
```

#### New function: `buy_shares`

Replaces `place_wager`. Atomic operation:

```sql
CREATE OR REPLACE FUNCTION public.buy_shares(
  p_bet_id uuid,
  p_user_id uuid,
  p_side text,       -- 'for' or 'against'
  p_amount integer
)
RETURNS TABLE(wager_id uuid, shares_received numeric, avg_price numeric) AS $$
DECLARE
  v_bet RECORD;
  v_group_id uuid;
  v_current_balance integer;
  v_existing_side text;
  v_shares numeric;
  v_new_yes numeric;
  v_new_no numeric;
  v_avg_price numeric;
  v_wager_id uuid;
BEGIN
  -- Lock the bet row to prevent concurrent AMM state corruption
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id FOR UPDATE;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet.status <> 'open' THEN
    RAISE EXCEPTION 'Bet is not open for wagers (status: %)', v_bet.status;
  END IF;

  -- Verify membership + balance
  SELECT gm.balance INTO v_current_balance
  FROM public.group_members gm
  WHERE gm.group_id = v_bet.group_id AND gm.user_id = p_user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %', v_current_balance, p_amount;
  END IF;

  -- Check user hasn't bet on the opposite side
  SELECT DISTINCT bw.side INTO v_existing_side
  FROM public.bet_wagers bw
  WHERE bw.bet_id = p_bet_id AND bw.user_id = p_user_id
  LIMIT 1;

  IF v_existing_side IS NOT NULL AND v_existing_side <> p_side THEN
    RAISE EXCEPTION 'Cannot bet on both sides. You already bet %', v_existing_side;
  END IF;

  -- Calculate shares via CPMM
  IF p_side = 'for' THEN
    -- Buying Yes: coins go into no_pool, shares from yes_pool
    v_new_no := v_bet.no_pool + p_amount;
    v_new_yes := v_bet.k / v_new_no;
    v_shares := v_bet.yes_pool - v_new_yes;
  ELSE
    -- Buying No: coins go into yes_pool, shares from no_pool
    v_new_yes := v_bet.yes_pool + p_amount;
    v_new_no := v_bet.k / v_new_yes;
    v_shares := v_bet.no_pool - v_new_no;
  END IF;

  IF v_shares <= 0 THEN
    RAISE EXCEPTION 'Trade too small, no shares received';
  END IF;

  v_avg_price := p_amount::numeric / v_shares;

  -- Update AMM pools on the bet
  UPDATE public.bets
  SET yes_pool = v_new_yes, no_pool = v_new_no
  WHERE id = p_bet_id;

  -- Deduct user balance
  UPDATE public.group_members
  SET balance = balance - p_amount
  WHERE group_id = v_bet.group_id AND user_id = p_user_id;

  -- Insert wager record
  INSERT INTO public.bet_wagers (bet_id, user_id, side, amount, shares, price_avg)
  VALUES (p_bet_id, p_user_id, p_side, p_amount, v_shares, v_avg_price)
  RETURNING id INTO v_wager_id;

  RETURN QUERY SELECT v_wager_id, v_shares, v_avg_price;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### New function: `resolve_market`

Replaces `resolve_bet`. Payout based on shares:

```sql
CREATE OR REPLACE FUNCTION public.resolve_market(
  p_bet_id uuid,
  p_outcome boolean,
  p_resolved_by uuid
)
RETURNS void AS $$
DECLARE
  v_bet RECORD;
  v_winner_side text;
  v_total_pot bigint;
  v_total_winner_shares numeric;
  v_payout_per_share numeric;
  v_wager RECORD;
BEGIN
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet.status NOT IN ('open', 'locked') THEN
    RAISE EXCEPTION 'Bet cannot be resolved (status: %)', v_bet.status;
  END IF;

  v_winner_side := CASE WHEN p_outcome THEN 'for' ELSE 'against' END;

  -- Total real money in the pot
  SELECT COALESCE(SUM(amount), 0) INTO v_total_pot
  FROM public.bet_wagers WHERE bet_id = p_bet_id;

  -- Total shares on winning side
  SELECT COALESCE(SUM(shares), 0) INTO v_total_winner_shares
  FROM public.bet_wagers WHERE bet_id = p_bet_id AND side = v_winner_side;

  -- Update bet status
  UPDATE public.bets
  SET status = 'resolved', outcome = p_outcome, resolved_at = now()
  WHERE id = p_bet_id;

  -- Pay winners proportionally to shares
  IF v_total_winner_shares > 0 THEN
    v_payout_per_share := v_total_pot::numeric / v_total_winner_shares;

    FOR v_wager IN
      SELECT id, user_id, shares
      FROM public.bet_wagers
      WHERE bet_id = p_bet_id AND side = v_winner_side
    LOOP
      DECLARE
        v_payout integer;
      BEGIN
        v_payout := FLOOR(v_wager.shares * v_payout_per_share)::integer;

        UPDATE public.bet_wagers SET payout = v_payout WHERE id = v_wager.id;

        UPDATE public.group_members
        SET balance = balance + v_payout
        WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id;
      END;
    END LOOP;
  END IF;

  -- Losers get payout = 0
  UPDATE public.bet_wagers
  SET payout = 0
  WHERE bet_id = p_bet_id AND side <> v_winner_side;

  -- Subject bonus (kept from original system)
  IF v_bet.subject_user_id IS NOT NULL
     AND p_outcome = true
     AND v_bet.subject_user_id <> v_bet.created_by
  THEN
    UPDATE public.group_members
    SET balance = balance + v_total_pot::integer
    WHERE group_id = v_bet.group_id AND user_id = v_bet.subject_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### Update `cancel_bet`

Add status guard (fixes existing bug) but otherwise same logic — refunds based on `amount`, ignores shares:

```sql
CREATE OR REPLACE FUNCTION public.cancel_bet(p_bet_id uuid)
RETURNS void AS $$
DECLARE
  v_bet RECORD;
  v_wager RECORD;
BEGIN
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet.status IN ('resolved', 'cancelled') THEN
    RAISE EXCEPTION 'Bet cannot be cancelled (status: %)', v_bet.status;
  END IF;

  UPDATE public.bets SET status = 'cancelled' WHERE id = p_bet_id;

  FOR v_wager IN
    SELECT id, user_id, amount FROM public.bet_wagers WHERE bet_id = p_bet_id
  LOOP
    UPDATE public.group_members
    SET balance = balance + v_wager.amount
    WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id;

    UPDATE public.bet_wagers SET payout = v_wager.amount WHERE id = v_wager.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### Update RLS

No new RLS policies needed — existing wager policies work. The UNIQUE constraint removal doesn't affect RLS.

---

## New Module: `src/lib/amm.ts`

Client-side AMM math for UI display and previews. No money logic — just calculations.

```typescript
// Core pricing
getYesPrice(yesPool, noPool) → number      // 0.0 to 1.0
getNoPrice(yesPool, noPool) → number       // 0.0 to 1.0

// Display formatting
getOddsDisplay(price) → string             // "3.2:1" or "Even"
getImpliedProbability(price) → string       // "31.2%"

// Trade preview
estimateShares(yesPool, noPool, k, side, amount) → {
  shares: number,
  avgPrice: number,
  priceImpact: number,         // how much the price moves (%)
  newYesPrice: number,
  newNoPrice: number,
}

// Payout preview
estimatePayout(userShares, totalWinningShares, totalPot) → number
```

---

## TypeScript Type Changes

### `src/lib/types/database.ts`

Update the `bets` table type:
```typescript
bets: {
  Row: {
    // ...existing fields...
    virtual_liquidity: number
    yes_pool: number
    no_pool: number
    k: number
    creator_side: 'for' | 'against' | null
    creator_wager_amount: number | null
  }
}
```

Update `bet_wagers` table type:
```typescript
bet_wagers: {
  Row: {
    // ...existing fields...
    shares: number
    price_avg: number
  }
}
```

Update `Functions`:
```typescript
Functions: {
  buy_shares: {
    Args: { p_bet_id: string; p_user_id: string; p_side: string; p_amount: number }
    Returns: { wager_id: string; shares_received: number; avg_price: number }
  }
  resolve_market: {
    Args: { p_bet_id: string; p_outcome: boolean; p_resolved_by: string }
    Returns: void
  }
  cancel_bet: {
    Args: { p_bet_id: string }
    Returns: void
  }
}
```

### `src/lib/types/app.ts`

Add AMM-related derived types:
```typescript
export type OddsInfo = {
  yesPrice: number
  noPrice: number
  yesOdds: string    // "3.2:1"
  noOdds: string
  yesProbability: string  // "31%"
  noProbability: string
}

export type TradePreview = {
  shares: number
  avgPrice: number
  priceImpact: number
  estimatedPayout: number  // if this side wins given current pot
}
```

---

## API Route Changes

### `/api/bets/wager/route.ts`

- Call `buy_shares` RPC instead of `place_wager`
- Return shares received + avg price in response
- Request body unchanged: `{ bet_id, side, amount }`

### `/api/bets/resolve/route.ts`

- Call `resolve_market` RPC instead of `resolve_bet`
- No other changes needed

### `/api/bets/cancel/route.ts`

- Still calls `cancel_bet` RPC (already updated in migration)

### Bet Creation Flow

Currently the `CreateBetForm` inserts directly into the `bets` table via Supabase client. The new flow needs to be atomic:

1. Insert the bet row (with AMM state initialized)
2. Place the creator's first wager via `buy_shares`

**Option A:** New API route `/api/bets/create` that does both in one request.
**Option B:** New PL/pgSQL function `create_market(...)` that does both atomically.

**Recommendation: Option B** — keeps the atomicity guarantee in the database.

```sql
CREATE OR REPLACE FUNCTION public.create_market(
  p_group_id uuid,
  p_created_by uuid,
  p_title text,
  p_description text,
  p_subject_user_id uuid,
  p_resolution_method text,
  p_deadline timestamptz,
  p_virtual_liquidity integer,
  p_creator_side text,
  p_creator_amount integer
)
RETURNS uuid AS $$
DECLARE
  v_bet_id uuid;
  v_k numeric;
BEGIN
  v_k := p_virtual_liquidity::numeric * p_virtual_liquidity::numeric;

  INSERT INTO public.bets (
    group_id, created_by, title, description, subject_user_id,
    resolution_method, deadline, virtual_liquidity,
    yes_pool, no_pool, k, creator_side, creator_wager_amount
  ) VALUES (
    p_group_id, p_created_by, p_title, p_description, p_subject_user_id,
    p_resolution_method, p_deadline, p_virtual_liquidity,
    p_virtual_liquidity, p_virtual_liquidity, v_k,
    p_creator_side, p_creator_amount
  ) RETURNING id INTO v_bet_id;

  -- Place creator's initial wager
  PERFORM public.buy_shares(v_bet_id, p_created_by, p_creator_side, p_creator_amount);

  RETURN v_bet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

New API route: `/api/bets/create/route.ts`
- Validates input
- Calls `create_market` RPC
- Returns bet ID

The `CreateBetForm` changes from direct Supabase insert to calling this API route.

---

## UI Changes

### `CreateBetForm`

**New fields added after existing fields:**
- **Side picker** (For / Against) — required, creator must pick a side
- **Wager amount** — required, with quick picks (10%, 25%, 50%)
- **Starting odds** — optional, defaults to 50/50. If creator wants to set custom starting odds (e.g., "I think this is a 70% chance"), the virtual liquidity split adjusts. *Stretch goal — defer to v2.*

**Removed:** Direct Supabase insert. Now calls `/api/bets/create`.

### `BetCard`

Add odds display:
- Show current Yes/No prices as percentages: "Yes 35% / No 65%"
- Show total pool size
- Color-code based on which side is favored

### Bet Detail Page (`groups/[id]/bets/[betId]/page.tsx`)

**Odds Header:** Large, prominent display of current odds (e.g., "Yes 35% — No 65%") with a visual indicator.

**Wager History:** Instead of just "For" and "Against" columns with amounts, show:
- Each purchase with: user, side, amount paid, shares received, price per share
- Sorted by time (shows how odds evolved)

**Pool Bar:** Keep the existing green/red bar but base percentages on share prices, not amounts.

**Your Position:** If user has wagered, show:
- Total shares held
- Average price paid
- Current value if your side wins (based on current total pot and shares)

### `WagerSection`

**Before confirming:**
- Show current price for the selected side (e.g., "Current price: 0.35 per share")
- As user types amount, live preview: "You'll receive ~142 shares at avg price 0.37"
- Show price impact: "This trade will move Yes from 35% → 42%"
- Show estimated payout: "If Yes wins, estimated payout: 285 coins"

**After confirming:**
- Show shares received and actual price

**Multiple purchases:** If user already has shares on this side, show "Add to position" instead of first-time UI. Show existing position summary.

### `ResolutionPanel`

- Payout preview should use share-based math
- Show what each user would receive based on their shares

### `bet-engine.ts`

Replace `calculateResolution` with share-based version. Replace `getOddsDisplay` with AMM-based version. Both should import from `amm.ts`.

---

## Implementation Order

### Phase 1: Core AMM Infrastructure
1. Write `src/lib/amm.ts` — pure math, no DB, fully testable
2. Update `src/lib/types/database.ts` and `app.ts` with new types
3. Write migration `003_amm_market_making.sql`

### Phase 2: Backend
4. Create `/api/bets/create/route.ts` (new endpoint)
5. Update `/api/bets/wager/route.ts` to call `buy_shares`
6. Update `/api/bets/resolve/route.ts` to call `resolve_market`
7. Update `/api/bets/cancel/route.ts` (picks up fixed cancel_bet)
8. Update `bet-engine.ts` to use new AMM math

### Phase 3: UI
9. Update `CreateBetForm` — add side picker + amount, call new API
10. Update `BetCard` — show current odds
11. Update bet detail page — odds display, share-based wager history
12. Update `WagerSection` — trade preview, multiple purchases
13. Update `ResolutionPanel` — share-based payout display

### Phase 4: Polish
14. Realtime hooks — add `yes_pool`/`no_pool` to subscriptions for live odds
15. Update leaderboard/history views if affected
16. Test edge cases: single-side markets, tiny bets, very large bets

---

## Edge Cases to Handle

### No one bets on the losing side
Total pot = only winner-side money. They just get their own money back (payout = amount for each winner). Effectively a cancelled bet where everyone agreed.

### Only the creator bets
Same as above — creator gets their money back. The bet was a dud.

### Very small bets relative to virtual liquidity
A 1-coin bet with V=500 gives almost no price movement and a proportional number of shares. This is fine — it just means odds barely moved.

### Very large bets relative to virtual liquidity
A 5000-coin bet with V=500 would cause extreme slippage. The first few coins buy cheap shares, the last few buy very expensive ones. The avg price will be significantly worse than the starting price. This is **by design** — it prevents one person from cornering the market cheaply.

### Creator bets on the subject (who isn't themselves)
Works fine. Creator bets, subject bonus still applies if subject succeeds. Creator could even bet against the subject and still trigger the subject bonus if outcome is true.

### Rounding
Use `FLOOR()` for payouts to avoid paying out more than the pot. Any remainder (a few coins from rounding) stays "in the house." Over many bets this is negligible.

---

## Subject Bonus in AMM Context

The subject bonus (subject gets full pot as inflationary bonus) still works with the AMM model. It's applied after normal share-based payouts. The full pot is the sum of real wager amounts, same as before.

**Open question for BRAINSTORM.md:** Should the subject bonus scale with the AMM model? Options:
- Keep as-is (full pot, inflationary)
- Scale to a percentage of pot
- Give bonus shares instead of coins
- Remove entirely — the AMM already rewards the subject if they bet on themselves early at good odds

---

## Files to Create or Modify

### New Files
- `supabase/migrations/003_amm_market_making.sql`
- `src/lib/amm.ts`
- `src/app/api/bets/create/route.ts`

### Modified Files
- `src/lib/types/database.ts` — new columns + functions
- `src/lib/types/app.ts` — new types (OddsInfo, TradePreview)
- `src/lib/bet-engine.ts` — rewrite to use AMM math
- `src/app/api/bets/wager/route.ts` — call buy_shares
- `src/app/api/bets/resolve/route.ts` — call resolve_market
- `src/app/api/bets/cancel/route.ts` — unchanged (cancel_bet updated in migration)
- `src/components/bets/create-bet-form.tsx` — side picker, amount, API call
- `src/components/bets/bet-card.tsx` — show odds
- `src/app/(app)/groups/[id]/bets/[betId]/page.tsx` — odds, shares display
- `src/components/bets/wager-section.tsx` — trade preview, multiple buys
- `src/components/bets/resolution-panel.tsx` — share-based payout preview
- `src/hooks/use-realtime-bets.ts` — include pool data in subscriptions
