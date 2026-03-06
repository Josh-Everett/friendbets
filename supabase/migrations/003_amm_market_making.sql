-- ============================================================================
-- 003_amm_market_making.sql
-- Transform betting system from fixed-stake pool-split to CPMM with dynamic
-- odds. Add economy features: transaction ledger, seasons, daily allowance.
-- ============================================================================


-- ============================================================================
-- 1. NEW TABLES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- transactions: immutable ledger of every currency movement
-- ---------------------------------------------------------------------------
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL CHECK (type IN (
    'wager_placed', 'bet_payout', 'bet_refund',
    'daily_allowance', 'season_reset', 'subject_bonus'
  )),
  amount integer NOT NULL, -- positive = credit, negative = debit
  balance_after integer NOT NULL,
  reference_type text, -- 'bet', 'wager', 'season', etc.
  reference_id uuid,
  description text,
  created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- seasons: archived season results per group
-- ---------------------------------------------------------------------------
CREATE TABLE public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  season_number integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  rankings jsonb, -- array of {user_id, username, display_name, final_balance, profit, rank}
  total_volume integer DEFAULT 0,
  total_bets integer DEFAULT 0,
  mvp_user_id uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);


-- ============================================================================
-- 2. ALTER EXISTING TABLES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- groups: add season configuration
-- ---------------------------------------------------------------------------
ALTER TABLE public.groups
  ADD COLUMN reset_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (reset_frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly'));

ALTER TABLE public.groups
  ADD COLUMN season_end_at timestamptz;

ALTER TABLE public.groups
  ADD COLUMN current_season_number integer NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- group_members: add daily allowance tracking
-- ---------------------------------------------------------------------------
ALTER TABLE public.group_members
  ADD COLUMN last_allowance_at timestamptz DEFAULT now();

-- ---------------------------------------------------------------------------
-- bets: add AMM state columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.bets
  ADD COLUMN virtual_liquidity integer NOT NULL DEFAULT 500;

ALTER TABLE public.bets
  ADD COLUMN yes_pool numeric NOT NULL DEFAULT 500;

ALTER TABLE public.bets
  ADD COLUMN no_pool numeric NOT NULL DEFAULT 500;

ALTER TABLE public.bets
  ADD COLUMN k numeric NOT NULL DEFAULT 250000;

ALTER TABLE public.bets
  ADD COLUMN creator_side text CHECK (creator_side IN ('for', 'against'));

ALTER TABLE public.bets
  ADD COLUMN creator_wager_amount integer CHECK (creator_wager_amount > 0);

-- ---------------------------------------------------------------------------
-- bet_wagers: add share tracking, allow multiple purchases per user per bet
-- ---------------------------------------------------------------------------
ALTER TABLE public.bet_wagers
  ADD COLUMN shares numeric NOT NULL DEFAULT 0;

ALTER TABLE public.bet_wagers
  ADD COLUMN price_avg numeric NOT NULL DEFAULT 0;

-- Remove unique constraint to allow multiple wagers per user per bet (same side)
ALTER TABLE public.bet_wagers
  DROP CONSTRAINT IF EXISTS bet_wagers_bet_id_user_id_key;


-- ============================================================================
-- 3. DROP OLD FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS public.place_wager(uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS public.resolve_bet(uuid, boolean, uuid);


-- ============================================================================
-- 4. DATABASE FUNCTIONS (SECURITY DEFINER)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- buy_shares: purchase shares on a bet side via CPMM
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buy_shares(
  p_bet_id uuid,
  p_user_id uuid,
  p_side text,       -- 'for' or 'against'
  p_amount integer
)
RETURNS TABLE(wager_id uuid, shares_received numeric, avg_price numeric) AS $$
DECLARE
  v_bet RECORD;
  v_current_balance integer;
  v_existing_side text;
  v_shares numeric;
  v_new_yes numeric;
  v_new_no numeric;
  v_avg_price numeric;
  v_wager_id uuid;
  v_new_balance integer;
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
    -- Buying Yes: coins go into no_pool, shares come from yes_pool
    v_new_no := v_bet.no_pool + p_amount;
    v_new_yes := v_bet.k / v_new_no;
    v_shares := v_bet.yes_pool - v_new_yes;
  ELSE
    -- Buying No: coins go into yes_pool, shares come from no_pool
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
  v_new_balance := v_current_balance - p_amount;

  UPDATE public.group_members
  SET balance = v_new_balance
  WHERE group_id = v_bet.group_id AND user_id = p_user_id;

  -- Insert wager record
  INSERT INTO public.bet_wagers (bet_id, user_id, side, amount, shares, price_avg)
  VALUES (p_bet_id, p_user_id, p_side, p_amount, v_shares, v_avg_price)
  RETURNING id INTO v_wager_id;

  -- Insert transaction ledger entry
  INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES (
    v_bet.group_id, p_user_id, 'wager_placed', -p_amount, v_new_balance,
    'wager', v_wager_id,
    'Bought ' || ROUND(v_shares, 2) || ' ' || p_side || ' shares on "' || LEFT(v_bet.title, 50) || '"'
  );

  RETURN QUERY SELECT v_wager_id, v_shares, v_avg_price;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- resolve_market: resolve a bet and pay winners based on shares
-- ---------------------------------------------------------------------------
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
  v_payout integer;
  v_member_balance integer;
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
      v_payout := FLOOR(v_wager.shares * v_payout_per_share)::integer;

      -- Update wager payout
      UPDATE public.bet_wagers SET payout = v_payout WHERE id = v_wager.id;

      -- Credit winner balance and get new balance
      UPDATE public.group_members
      SET balance = balance + v_payout
      WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id
      RETURNING balance INTO v_member_balance;

      -- Insert payout transaction
      INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
      VALUES (
        v_bet.group_id, v_wager.user_id, 'bet_payout', v_payout, v_member_balance,
        'bet', p_bet_id,
        'Won ' || v_payout || ' from "' || LEFT(v_bet.title, 50) || '"'
      );
    END LOOP;
  END IF;

  -- Losers get payout = 0
  UPDATE public.bet_wagers
  SET payout = 0
  WHERE bet_id = p_bet_id AND side <> v_winner_side;

  -- Subject bonus: if subject_user_id exists AND outcome is true AND subject != created_by
  -- Credit the subject with the FULL POT as an inflationary bonus
  IF v_bet.subject_user_id IS NOT NULL
     AND p_outcome = true
     AND v_bet.subject_user_id <> v_bet.created_by
  THEN
    UPDATE public.group_members
    SET balance = balance + v_total_pot::integer
    WHERE group_id = v_bet.group_id AND user_id = v_bet.subject_user_id
    RETURNING balance INTO v_member_balance;

    -- Insert subject bonus transaction
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (
      v_bet.group_id, v_bet.subject_user_id, 'subject_bonus', v_total_pot::integer, v_member_balance,
      'bet', p_bet_id,
      'Subject bonus from "' || LEFT(v_bet.title, 50) || '"'
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- create_market: atomically create a bet + place the creator's first wager
-- ---------------------------------------------------------------------------
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
  v_is_member boolean;
BEGIN
  -- Verify creator is a group member
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_created_by
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  -- Calculate constant product
  v_k := p_virtual_liquidity::numeric * p_virtual_liquidity::numeric;

  -- Insert bet row with AMM state initialized
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


-- ---------------------------------------------------------------------------
-- cancel_bet: cancel a bet and refund all wagers (REPLACES existing function)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_bet(
  p_bet_id uuid
)
RETURNS void AS $$
DECLARE
  v_bet RECORD;
  v_wager RECORD;
  v_member_balance integer;
BEGIN
  -- Fetch the bet
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  -- Status guard: cannot cancel resolved or already-cancelled bets
  IF v_bet.status IN ('resolved', 'cancelled') THEN
    RAISE EXCEPTION 'Bet cannot be cancelled (status: %)', v_bet.status;
  END IF;

  -- Set status to cancelled
  UPDATE public.bets
  SET status = 'cancelled'
  WHERE id = p_bet_id;

  -- Refund all wagers
  FOR v_wager IN
    SELECT id, user_id, amount
    FROM public.bet_wagers
    WHERE bet_id = p_bet_id
  LOOP
    -- Credit user's balance back
    UPDATE public.group_members
    SET balance = balance + v_wager.amount
    WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id
    RETURNING balance INTO v_member_balance;

    -- Update payout to equal amount (refund)
    UPDATE public.bet_wagers
    SET payout = v_wager.amount
    WHERE id = v_wager.id;

    -- Insert refund transaction
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (
      v_bet.group_id, v_wager.user_id, 'bet_refund', v_wager.amount, v_member_balance,
      'wager', v_wager.id,
      'Refund from cancelled bet "' || LEFT(v_bet.title, 50) || '"'
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- credit_daily_allowance: credit a user's daily allowance if 24h have passed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_daily_allowance(
  p_group_id uuid,
  p_user_id uuid
)
RETURNS integer AS $$
DECLARE
  v_member RECORD;
  v_group RECORD;
  v_allowance integer;
  v_new_balance integer;
BEGIN
  -- Get member record
  SELECT * INTO v_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  -- Check if 24 hours have passed since last allowance
  IF v_member.last_allowance_at IS NOT NULL
     AND v_member.last_allowance_at > now() - interval '24 hours'
  THEN
    RETURN 0; -- Not due yet
  END IF;

  -- Get group starting balance to calculate allowance
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  -- Calculate allowance: 5% of starting balance, floored
  v_allowance := FLOOR(v_group.starting_balance * 0.05)::integer;

  IF v_allowance <= 0 THEN
    RETURN 0;
  END IF;

  -- Credit balance and update last_allowance_at
  v_new_balance := v_member.balance + v_allowance;

  UPDATE public.group_members
  SET balance = v_new_balance,
      last_allowance_at = now()
  WHERE group_id = p_group_id AND user_id = p_user_id;

  -- Insert transaction ledger entry
  INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES (
    p_group_id, p_user_id, 'daily_allowance', v_allowance, v_new_balance,
    'group', p_group_id,
    'Daily allowance of ' || v_allowance || ' ' || v_group.currency_name
  );

  RETURN v_allowance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- reset_season: archive current season, reset balances, cancel active bets
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_season(
  p_group_id uuid
)
RETURNS boolean AS $$
DECLARE
  v_group RECORD;
  v_rankings jsonb;
  v_mvp_user_id uuid;
  v_total_volume integer;
  v_total_bets integer;
  v_season_started_at timestamptz;
  v_new_season_end timestamptz;
  v_member RECORD;
  v_active_bet RECORD;
BEGIN
  -- Get group record
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- Check if season should reset
  IF v_group.season_end_at IS NULL OR now() <= v_group.season_end_at THEN
    RETURN false; -- Not time to reset yet
  END IF;

  -- Build rankings from current member balances
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', gm.user_id,
      'username', p.username,
      'display_name', p.display_name,
      'final_balance', gm.balance,
      'profit', gm.balance - v_group.starting_balance,
      'rank', ROW_NUMBER() OVER (ORDER BY gm.balance DESC)
    )
    ORDER BY gm.balance DESC
  )
  INTO v_rankings
  FROM public.group_members gm
  JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = p_group_id;

  -- Find MVP (highest profit)
  SELECT gm.user_id INTO v_mvp_user_id
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
  ORDER BY gm.balance DESC
  LIMIT 1;

  -- Calculate season volume and bet count
  SELECT COALESCE(SUM(bw.amount), 0), COUNT(DISTINCT b.id)
  INTO v_total_volume, v_total_bets
  FROM public.bets b
  LEFT JOIN public.bet_wagers bw ON bw.bet_id = b.id
  WHERE b.group_id = p_group_id
    AND b.created_at >= COALESCE(v_group.season_end_at - (
      CASE v_group.reset_frequency
        WHEN 'weekly' THEN interval '7 days'
        WHEN 'biweekly' THEN interval '14 days'
        WHEN 'monthly' THEN interval '30 days'
        WHEN 'quarterly' THEN interval '90 days'
      END
    ), v_group.created_at);

  -- Archive current season
  INSERT INTO public.seasons (
    group_id, season_number, started_at, ended_at,
    rankings, total_volume, total_bets, mvp_user_id
  ) VALUES (
    p_group_id, v_group.current_season_number,
    COALESCE(v_group.season_end_at - (
      CASE v_group.reset_frequency
        WHEN 'weekly' THEN interval '7 days'
        WHEN 'biweekly' THEN interval '14 days'
        WHEN 'monthly' THEN interval '30 days'
        WHEN 'quarterly' THEN interval '90 days'
      END
    ), v_group.created_at),
    now(),
    v_rankings, v_total_volume, v_total_bets, v_mvp_user_id
  );

  -- Force-cancel all active/locked bets in the group
  FOR v_active_bet IN
    SELECT id FROM public.bets
    WHERE group_id = p_group_id AND status IN ('open', 'locked')
  LOOP
    PERFORM public.cancel_bet(v_active_bet.id);
  END LOOP;

  -- Reset all member balances to starting_balance
  FOR v_member IN
    SELECT user_id FROM public.group_members WHERE group_id = p_group_id
  LOOP
    UPDATE public.group_members
    SET balance = v_group.starting_balance,
        last_allowance_at = now()
    WHERE group_id = p_group_id AND user_id = v_member.user_id;

    -- Insert season reset transaction
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (
      p_group_id, v_member.user_id, 'season_reset', 0, v_group.starting_balance,
      'season', (SELECT id FROM public.seasons WHERE group_id = p_group_id AND season_number = v_group.current_season_number),
      'Season ' || v_group.current_season_number || ' reset — balance restored to ' || v_group.starting_balance
    );
  END LOOP;

  -- Advance season_end_at based on reset_frequency
  v_new_season_end := v_group.season_end_at + (
    CASE v_group.reset_frequency
      WHEN 'weekly' THEN interval '7 days'
      WHEN 'biweekly' THEN interval '14 days'
      WHEN 'monthly' THEN interval '30 days'
      WHEN 'quarterly' THEN interval '90 days'
    END
  );

  -- If the new end date is still in the past, advance to a future date
  WHILE v_new_season_end <= now() LOOP
    v_new_season_end := v_new_season_end + (
      CASE v_group.reset_frequency
        WHEN 'weekly' THEN interval '7 days'
        WHEN 'biweekly' THEN interval '14 days'
        WHEN 'monthly' THEN interval '30 days'
        WHEN 'quarterly' THEN interval '90 days'
      END
    );
  END LOOP;

  -- Update group season state
  UPDATE public.groups
  SET season_end_at = v_new_season_end,
      current_season_number = current_season_number + 1
  WHERE id = p_group_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- transactions: group members can view their group's transactions
-- ---------------------------------------------------------------------------
CREATE POLICY "Group members can view transactions"
ON public.transactions FOR SELECT
TO authenticated
USING (
  group_id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- seasons: group members can view their group's seasons
-- ---------------------------------------------------------------------------
CREATE POLICY "Group members can view seasons"
ON public.seasons FOR SELECT
TO authenticated
USING (
  group_id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  )
);


-- ============================================================================
-- 6. INDEXES
-- ============================================================================

CREATE INDEX idx_transactions_group_user ON public.transactions(group_id, user_id);
CREATE INDEX idx_transactions_reference ON public.transactions(reference_type, reference_id);
CREATE INDEX idx_transactions_created ON public.transactions(created_at);
CREATE INDEX idx_seasons_group ON public.seasons(group_id);
