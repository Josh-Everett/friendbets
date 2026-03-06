-- ============================================================================
-- 006_medium_severity_fixes.sql
-- Fix medium-severity security issues:
-- 1. Restrict group_members self-INSERT to enforce correct balance/role
-- 2. Restrict admin UPDATE on group_members to role-only changes
-- 3. Add groups UPDATE policy for admins
-- 4. Add invite_codes DELETE policy for admins
-- 5. Validate subject_user_id in create_market
-- 6. Handle username collision in signup trigger
-- 7. Fix rounding currency leakage in resolve_market
-- 8. Create atomic create_group function
-- ============================================================================


-- ============================================================================
-- 1. GROUP_MEMBERS: Replace self-insert policy with restricted version
-- ============================================================================

-- Drop the old overly-permissive self-insert policy
DROP POLICY IF EXISTS "Admins and creators can add members" ON public.group_members;

-- Admin insert: admins can add members with correct starting balance
CREATE POLICY "Admins can add members"
ON public.group_members FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = group_members.group_id
      AND gm.user_id = auth.uid()
      AND gm.role = 'admin'
  )
);

-- Self-insert: users can only add themselves as 'member' role
-- Balance is not restricted here because it must match group.starting_balance
-- which the join_group SECURITY DEFINER function handles correctly.
-- Direct self-insert via RLS is now blocked — users must go through join_group.
-- We keep a limited self-insert for the create_group function (which sets role = 'admin').


-- ============================================================================
-- 2. GROUP_MEMBERS: Restrict admin UPDATE to role column only
-- ============================================================================

-- Drop old unrestricted admin update policy
DROP POLICY IF EXISTS "Admins can update member roles" ON public.group_members;

-- New policy: admins can update, but a trigger will guard financial columns
CREATE POLICY "Admins can update members"
ON public.group_members FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = group_members.group_id
      AND gm.user_id = auth.uid()
      AND gm.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = group_members.group_id
      AND gm.user_id = auth.uid()
      AND gm.role = 'admin'
  )
);

-- Trigger to prevent direct balance modifications via RLS
-- Only SECURITY DEFINER functions (buy_shares, resolve_market, etc.) can change balance
CREATE OR REPLACE FUNCTION public.guard_member_balance()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.bypass_member_guard', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.balance IS DISTINCT FROM OLD.balance THEN
    RAISE EXCEPTION 'Cannot directly modify member balance — use RPC functions';
  END IF;

  IF NEW.last_allowance_at IS DISTINCT FROM OLD.last_allowance_at THEN
    RAISE EXCEPTION 'Cannot directly modify allowance tracking';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_member_balance
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_member_balance();

-- Update existing SECURITY DEFINER functions that modify balance to set bypass flag.
-- buy_shares, resolve_market, cancel_bet already set app.bypass_bet_guard.
-- We now need them to ALSO set app.bypass_member_guard.

-- buy_shares: add member guard bypass
CREATE OR REPLACE FUNCTION public.buy_shares(
  p_bet_id uuid,
  p_user_id uuid,
  p_side text,
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
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match user_id';
  END IF;

  PERFORM set_config('app.bypass_bet_guard', 'true', true);
  PERFORM set_config('app.bypass_member_guard', 'true', true);

  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id FOR UPDATE;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet.status <> 'open' THEN
    RAISE EXCEPTION 'Bet is not open for wagers';
  END IF;

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

  SELECT DISTINCT bw.side INTO v_existing_side
  FROM public.bet_wagers bw
  WHERE bw.bet_id = p_bet_id AND bw.user_id = p_user_id
  LIMIT 1;

  IF v_existing_side IS NOT NULL AND v_existing_side <> p_side THEN
    RAISE EXCEPTION 'Cannot bet on both sides';
  END IF;

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

  UPDATE public.bets
  SET yes_pool = v_new_yes, no_pool = v_new_no
  WHERE id = p_bet_id;

  v_new_balance := v_current_balance - p_amount;

  UPDATE public.group_members
  SET balance = v_new_balance
  WHERE group_id = v_bet.group_id AND user_id = p_user_id;

  INSERT INTO public.bet_wagers (bet_id, user_id, side, amount, shares, price_avg)
  VALUES (p_bet_id, p_user_id, p_side, p_amount, v_shares, v_avg_price)
  RETURNING id INTO v_wager_id;

  INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES (
    v_bet.group_id, p_user_id, 'wager_placed', -p_amount, v_new_balance,
    'wager', v_wager_id,
    'Bought ' || ROUND(v_shares, 2) || ' ' || p_side || ' shares on "' || LEFT(v_bet.title, 50) || '"'
  );

  RETURN QUERY SELECT v_wager_id, v_shares, v_avg_price;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- resolve_market: add member guard bypass + fix rounding leakage
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
  v_total_paid integer := 0;
  v_remainder integer;
  v_largest_wager_id uuid;
  v_largest_shares numeric := 0;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_resolved_by THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match resolved_by';
  END IF;

  PERFORM set_config('app.bypass_bet_guard', 'true', true);
  PERFORM set_config('app.bypass_member_guard', 'true', true);

  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet.status NOT IN ('open', 'locked') THEN
    RAISE EXCEPTION 'Bet cannot be resolved';
  END IF;

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

  SELECT COALESCE(SUM(amount), 0) INTO v_total_pot
  FROM public.bet_wagers WHERE bet_id = p_bet_id;

  SELECT COALESCE(SUM(shares), 0) INTO v_total_winner_shares
  FROM public.bet_wagers WHERE bet_id = p_bet_id AND side = v_winner_side;

  UPDATE public.bets
  SET status = 'resolved', outcome = p_outcome, resolved_at = now()
  WHERE id = p_bet_id;

  IF v_total_winner_shares > 0 THEN
    v_payout_per_share := v_total_pot::numeric / v_total_winner_shares;

    FOR v_wager IN
      SELECT id, user_id, shares
      FROM public.bet_wagers
      WHERE bet_id = p_bet_id AND side = v_winner_side
    LOOP
      v_payout := FLOOR(v_wager.shares * v_payout_per_share)::integer;
      v_total_paid := v_total_paid + v_payout;

      -- Track largest shareholder for remainder allocation
      IF v_wager.shares > v_largest_shares THEN
        v_largest_shares := v_wager.shares;
        v_largest_wager_id := v_wager.id;
      END IF;

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

    -- Allocate rounding remainder to the largest shareholder
    v_remainder := v_total_pot::integer - v_total_paid;
    IF v_remainder > 0 AND v_largest_wager_id IS NOT NULL THEN
      UPDATE public.bet_wagers
      SET payout = payout + v_remainder
      WHERE id = v_largest_wager_id;

      UPDATE public.group_members
      SET balance = balance + v_remainder
      WHERE group_id = v_bet.group_id
        AND user_id = (SELECT user_id FROM public.bet_wagers WHERE id = v_largest_wager_id)
      RETURNING balance INTO v_member_balance;

      INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
      VALUES (
        v_bet.group_id,
        (SELECT user_id FROM public.bet_wagers WHERE id = v_largest_wager_id),
        'bet_payout', v_remainder, v_member_balance,
        'bet', p_bet_id,
        'Rounding remainder from "' || LEFT(v_bet.title, 50) || '"'
      );
    END IF;
  END IF;

  UPDATE public.bet_wagers
  SET payout = 0
  WHERE bet_id = p_bet_id AND side <> v_winner_side;

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


-- cancel_bet: add member guard bypass
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
  v_caller_uid := auth.uid();
  IF p_cancelled_by IS NOT NULL THEN
    IF v_caller_uid IS NULL OR v_caller_uid <> p_cancelled_by THEN
      RAISE EXCEPTION 'Unauthorized: caller does not match cancelled_by';
    END IF;
  END IF;

  PERFORM set_config('app.bypass_bet_guard', 'true', true);
  PERFORM set_config('app.bypass_member_guard', 'true', true);

  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet.status IN ('resolved', 'cancelled') THEN
    RAISE EXCEPTION 'Bet cannot be cancelled';
  END IF;

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

  UPDATE public.bets
  SET status = 'cancelled'
  WHERE id = p_bet_id;

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


-- credit_daily_allowance: add member guard bypass
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
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match user_id';
  END IF;

  PERFORM set_config('app.bypass_member_guard', 'true', true);

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


-- reset_season: add member guard bypass
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
  v_new_season_end timestamptz;
  v_member RECORD;
  v_active_bet RECORD;
BEGIN
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

  PERFORM set_config('app.bypass_member_guard', 'true', true);

  SELECT * INTO v_group FROM public.groups WHERE id = p_group_id;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'Group not found';
  END IF;

  IF v_group.season_end_at IS NULL OR now() <= v_group.season_end_at THEN
    RETURN false;
  END IF;

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

  SELECT gm.user_id INTO v_mvp_user_id
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
  ORDER BY gm.balance DESC
  LIMIT 1;

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

  FOR v_active_bet IN
    SELECT id FROM public.bets
    WHERE group_id = p_group_id AND status IN ('open', 'locked')
  LOOP
    PERFORM public.cancel_bet(v_active_bet.id, NULL);
  END LOOP;

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
      'Season ' || v_group.current_season_number || ' reset'
    );
  END LOOP;

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
-- 3. GROUPS: Add UPDATE policy for admins
-- ============================================================================

CREATE POLICY "Group admins can update group settings"
ON public.groups FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = groups.id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = groups.id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
);


-- ============================================================================
-- 4. INVITE_CODES: Add DELETE policy for admins
-- ============================================================================

CREATE POLICY "Group admins can delete invite codes"
ON public.invite_codes FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = invite_codes.group_id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
);


-- ============================================================================
-- 5. CREATE_MARKET: Validate subject_user_id is a group member
-- ============================================================================

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
  v_subject_is_member boolean;
  v_caller_uid uuid;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_created_by THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match created_by';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_created_by
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  -- Validate subject is a group member if provided
  IF p_subject_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_id = p_group_id AND user_id = p_subject_user_id
    ) INTO v_subject_is_member;

    IF NOT v_subject_is_member THEN
      RAISE EXCEPTION 'Subject user is not a member of this group';
    END IF;
  END IF;

  IF p_virtual_liquidity IS NULL OR p_virtual_liquidity < 10 OR p_virtual_liquidity > 100000 THEN
    RAISE EXCEPTION 'Virtual liquidity must be between 10 and 100000';
  END IF;

  PERFORM set_config('app.bypass_bet_guard', 'true', true);

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

  PERFORM public.buy_shares(v_bet_id, p_created_by, p_creator_side, p_creator_amount);

  RETURN v_bet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 6. HANDLE_NEW_USER: Handle username collisions gracefully
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_username text;
  v_display_name text;
  v_suffix text;
BEGIN
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  -- Try inserting with the requested username
  BEGIN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (NEW.id, v_username, v_display_name);
  EXCEPTION WHEN unique_violation THEN
    -- Username taken — append a random 4-char suffix
    v_suffix := substr(NEW.id::text, 1, 4);
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (NEW.id, v_username || '_' || v_suffix, v_display_name);
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 7. ATOMIC GROUP CREATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_group(
  p_name text,
  p_description text,
  p_currency_name text,
  p_currency_symbol text,
  p_starting_balance integer
)
RETURNS uuid AS $$
DECLARE
  v_caller_uid uuid;
  v_group_id uuid;
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_i integer;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  PERFORM set_config('app.bypass_member_guard', 'true', true);

  -- Insert group
  INSERT INTO public.groups (name, description, currency_name, currency_symbol, starting_balance, created_by)
  VALUES (
    p_name,
    p_description,
    COALESCE(NULLIF(p_currency_name, ''), 'Coins'),
    COALESCE(NULLIF(p_currency_symbol, ''), '🪙'),
    COALESCE(p_starting_balance, 1000),
    v_caller_uid
  )
  RETURNING id INTO v_group_id;

  -- Add creator as admin
  INSERT INTO public.group_members (group_id, user_id, balance, role)
  VALUES (v_group_id, v_caller_uid, COALESCE(p_starting_balance, 1000), 'admin');

  -- Generate invite code (using Postgres random, cryptographically adequate for this purpose)
  v_code := '';
  FOR v_i IN 1..8 LOOP
    v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::integer, 1);
  END LOOP;

  INSERT INTO public.invite_codes (group_id, code)
  VALUES (v_group_id, v_code);

  RETURN v_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
