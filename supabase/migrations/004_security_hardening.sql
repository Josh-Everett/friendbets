-- ============================================================================
-- 004_security_hardening.sql
-- Fix critical security vulnerabilities:
-- 1. Add auth.uid() validation to ALL SECURITY DEFINER functions
-- 2. Add authorization checks (creator/admin) to resolve_market, cancel_bet
-- 3. Add invite_codes RLS policy for non-members (join flow was broken)
-- 4. Add CHECK (balance >= 0) constraint on group_members
-- ============================================================================


-- ============================================================================
-- 1. REPLACE FUNCTIONS WITH AUTH CHECKS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- buy_shares: now validates auth.uid() = p_user_id
-- Also adds FOR UPDATE on group_members to prevent double-spend
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
  v_caller_uid uuid;
BEGIN
  -- Security: verify caller identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match user_id';
  END IF;

  -- Lock the bet row to prevent concurrent AMM state corruption
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id FOR UPDATE;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet.status <> 'open' THEN
    RAISE EXCEPTION 'Bet is not open for wagers';
  END IF;

  -- Verify membership + balance (FOR UPDATE to prevent double-spend)
  SELECT gm.balance INTO v_current_balance
  FROM public.group_members gm
  WHERE gm.group_id = v_bet.group_id AND gm.user_id = p_user_id
  FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Check user hasn't bet on the opposite side
  SELECT DISTINCT bw.side INTO v_existing_side
  FROM public.bet_wagers bw
  WHERE bw.bet_id = p_bet_id AND bw.user_id = p_user_id
  LIMIT 1;

  IF v_existing_side IS NOT NULL AND v_existing_side <> p_side THEN
    RAISE EXCEPTION 'Cannot bet on both sides';
  END IF;

  -- Calculate shares via CPMM
  IF p_side = 'for' THEN
    v_new_no := v_bet.no_pool + p_amount;
    v_new_yes := v_bet.k / v_new_no;
    v_shares := v_bet.yes_pool - v_new_yes;
  ELSE
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
-- resolve_market: now validates auth.uid() and checks creator/admin auth
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_market(
  p_bet_id uuid,
  p_outcome boolean,
  p_resolved_by uuid
)
RETURNS void AS $$
DECLARE
  v_bet RECORD;
  v_caller_uid uuid;
  v_is_authorized boolean;
  v_winner_side text;
  v_total_pot bigint;
  v_total_winner_shares numeric;
  v_payout_per_share numeric;
  v_wager RECORD;
  v_payout integer;
  v_member_balance integer;
BEGIN
  -- Security: verify caller identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_resolved_by THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match resolved_by';
  END IF;

  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet.status NOT IN ('open', 'locked') THEN
    RAISE EXCEPTION 'Bet cannot be resolved';
  END IF;

  -- Authorization: must be bet creator or group admin
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_bet.group_id
      AND user_id = v_caller_uid
      AND (v_bet.created_by = v_caller_uid OR role = 'admin')
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Only the bet creator or a group admin can resolve this bet';
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

      UPDATE public.bet_wagers SET payout = v_payout WHERE id = v_wager.id;

      UPDATE public.group_members
      SET balance = balance + v_payout
      WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id
      RETURNING balance INTO v_member_balance;

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

  -- Subject bonus
  IF v_bet.subject_user_id IS NOT NULL
     AND p_outcome = true
     AND v_bet.subject_user_id <> v_bet.created_by
  THEN
    UPDATE public.group_members
    SET balance = balance + v_total_pot::integer
    WHERE group_id = v_bet.group_id AND user_id = v_bet.subject_user_id
    RETURNING balance INTO v_member_balance;

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
-- create_market: now validates auth.uid() = p_created_by
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
  v_caller_uid uuid;
BEGIN
  -- Security: verify caller identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_created_by THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match created_by';
  END IF;

  -- Verify creator is a group member
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_created_by
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  -- Validate virtual_liquidity range
  IF p_virtual_liquidity IS NULL OR p_virtual_liquidity < 10 OR p_virtual_liquidity > 100000 THEN
    RAISE EXCEPTION 'Virtual liquidity must be between 10 and 100000';
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
-- cancel_bet: now validates auth.uid() and checks creator/admin auth
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_bet(
  p_bet_id uuid,
  p_cancelled_by uuid DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_bet RECORD;
  v_caller_uid uuid;
  v_is_authorized boolean;
  v_wager RECORD;
  v_member_balance integer;
BEGIN
  -- Security: verify caller identity (skip when called internally by reset_season)
  v_caller_uid := auth.uid();
  IF p_cancelled_by IS NOT NULL THEN
    IF v_caller_uid IS NULL OR v_caller_uid <> p_cancelled_by THEN
      RAISE EXCEPTION 'Unauthorized: caller does not match cancelled_by';
    END IF;
  END IF;

  -- Fetch the bet
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  -- Status guard
  IF v_bet.status IN ('resolved', 'cancelled') THEN
    RAISE EXCEPTION 'Bet cannot be cancelled';
  END IF;

  -- Authorization: must be bet creator or group admin (skip for internal calls)
  IF p_cancelled_by IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_id = v_bet.group_id
        AND user_id = v_caller_uid
        AND (v_bet.created_by = v_caller_uid OR role = 'admin')
    ) INTO v_is_authorized;

    IF NOT v_is_authorized THEN
      RAISE EXCEPTION 'Only the bet creator or a group admin can cancel this bet';
    END IF;
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
    UPDATE public.group_members
    SET balance = balance + v_wager.amount
    WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id
    RETURNING balance INTO v_member_balance;

    UPDATE public.bet_wagers
    SET payout = v_wager.amount
    WHERE id = v_wager.id;

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
-- credit_daily_allowance: now validates auth.uid() = p_user_id
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
  v_caller_uid uuid;
BEGIN
  -- Security: verify caller identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match user_id';
  END IF;

  SELECT * INTO v_member
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  IF v_member.last_allowance_at IS NOT NULL
     AND v_member.last_allowance_at > now() - interval '24 hours'
  THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  v_allowance := FLOOR(v_group.starting_balance * 0.05)::integer;

  IF v_allowance <= 0 THEN
    RETURN 0;
  END IF;

  v_new_balance := v_member.balance + v_allowance;

  UPDATE public.group_members
  SET balance = v_new_balance,
      last_allowance_at = now()
  WHERE group_id = p_group_id AND user_id = p_user_id;

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
-- reset_season: now validates caller is a group member
-- (time guard still prevents premature resets)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_season(
  p_group_id uuid
)
RETURNS boolean AS $$
DECLARE
  v_group RECORD;
  v_caller_uid uuid;
  v_is_member boolean;
  v_rankings jsonb;
  v_mvp_user_id uuid;
  v_total_volume integer;
  v_total_bets integer;
  v_season_started_at timestamptz;
  v_new_season_end timestamptz;
  v_member RECORD;
  v_active_bet RECORD;
BEGIN
  -- Security: verify caller is a group member
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = v_caller_uid
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'Unauthorized: not a member of this group';
  END IF;

  -- Get group record
  SELECT * INTO v_group
  FROM public.groups
  WHERE id = p_group_id;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  -- Check if season should reset
  IF v_group.season_end_at IS NULL OR now() <= v_group.season_end_at THEN
    RETURN false;
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

  -- Find MVP
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

  -- Force-cancel all active/locked bets (internal call, no p_cancelled_by)
  FOR v_active_bet IN
    SELECT id FROM public.bets
    WHERE group_id = p_group_id AND status IN ('open', 'locked')
  LOOP
    PERFORM public.cancel_bet(v_active_bet.id, NULL);
  END LOOP;

  -- Reset all member balances
  FOR v_member IN
    SELECT user_id FROM public.group_members WHERE group_id = p_group_id
  LOOP
    UPDATE public.group_members
    SET balance = v_group.starting_balance,
        last_allowance_at = now()
    WHERE group_id = p_group_id AND user_id = v_member.user_id;

    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (
      p_group_id, v_member.user_id, 'season_reset', 0, v_group.starting_balance,
      'season', (SELECT id FROM public.seasons WHERE group_id = p_group_id AND season_number = v_group.current_season_number),
      'Season ' || v_group.current_season_number || ' reset — balance restored to ' || v_group.starting_balance
    );
  END LOOP;

  -- Advance season_end_at
  v_new_season_end := v_group.season_end_at + (
    CASE v_group.reset_frequency
      WHEN 'weekly' THEN interval '7 days'
      WHEN 'biweekly' THEN interval '14 days'
      WHEN 'monthly' THEN interval '30 days'
      WHEN 'quarterly' THEN interval '90 days'
    END
  );

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

  UPDATE public.groups
  SET season_end_at = v_new_season_end,
      current_season_number = current_season_number + 1
  WHERE id = p_group_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 2. INVITE CODES RLS: Allow non-members to look up codes (fixes join flow)
-- ============================================================================

-- Any authenticated user can look up invite codes by code value
-- This is required for the join flow where non-members need to validate a code
CREATE POLICY "Anyone can look up invite codes by code"
ON public.invite_codes FOR SELECT
TO authenticated
USING (true);


-- ============================================================================
-- 3. BALANCE CONSTRAINT: Prevent negative balances
-- ============================================================================

ALTER TABLE public.group_members
  ADD CONSTRAINT balance_non_negative CHECK (balance >= 0);
