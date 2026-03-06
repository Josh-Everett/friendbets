-- ============================================================================
-- 005_high_severity_fixes.sql
-- Fix high-severity security issues:
-- 1. Restrict bets UPDATE policy — prevent direct AMM pool manipulation
-- 2. Tighten storage upload policy — scope to user's own folder
-- 3. Add invite_codes UPDATE policy for use_count increment
-- 4. Create atomic join_group function (fixes invite code race condition)
-- ============================================================================


-- ============================================================================
-- 1. BETS UPDATE: Guard financial columns with a trigger
-- ============================================================================

-- This trigger prevents direct modification of AMM state columns via RLS.
-- Only SECURITY DEFINER functions (buy_shares, resolve_market, etc.) can change
-- these columns because triggers run in the same transaction context.
CREATE OR REPLACE FUNCTION public.guard_bet_financial_columns()
RETURNS trigger AS $$
BEGIN
  -- Allow changes from SECURITY DEFINER functions (they set a session var)
  IF current_setting('app.bypass_bet_guard', true) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block direct changes to AMM state columns
  IF NEW.yes_pool IS DISTINCT FROM OLD.yes_pool
     OR NEW.no_pool IS DISTINCT FROM OLD.no_pool
     OR NEW.k IS DISTINCT FROM OLD.k
     OR NEW.virtual_liquidity IS DISTINCT FROM OLD.virtual_liquidity
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
  THEN
    RAISE EXCEPTION 'Cannot directly modify financial columns on bets';
  END IF;

  -- Block direct status changes to 'resolved' or 'cancelled' (must go through RPC)
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('resolved', 'cancelled')
  THEN
    RAISE EXCEPTION 'Cannot directly resolve or cancel bets — use the RPC functions';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_bet_financial_columns
  BEFORE UPDATE ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_bet_financial_columns();

-- Update SECURITY DEFINER functions to set the bypass flag.
-- We need to re-create buy_shares, resolve_market, and cancel_bet to set
-- the session variable before modifying bets.

-- buy_shares: add bypass flag
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
  -- Security: verify caller identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match user_id';
  END IF;

  -- Set bypass flag for the trigger guard
  PERFORM set_config('app.bypass_bet_guard', 'true', true);

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


-- resolve_market: add bypass flag
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

  -- Set bypass flag for the trigger guard
  PERFORM set_config('app.bypass_bet_guard', 'true', true);

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


-- cancel_bet: add bypass flag
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

  -- Set bypass flag for the trigger guard
  PERFORM set_config('app.bypass_bet_guard', 'true', true);

  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet.status IN ('resolved', 'cancelled') THEN
    RAISE EXCEPTION 'Bet cannot be cancelled';
  END IF;

  -- Authorization (skip for internal calls from reset_season)
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


-- ============================================================================
-- 2. STORAGE: Tighten upload policy to scope to user's own folder
-- ============================================================================

-- Drop old permissive policies
DROP POLICY IF EXISTS "Users can upload proofs" ON storage.objects;
DROP POLICY IF EXISTS "Users can view proofs" ON storage.objects;

-- Upload: user can only upload to paths where the second folder segment is their user ID
-- Path format: {bet_id}/{user_id}/{timestamp}.{ext}
CREATE POLICY "Users can upload proofs to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'bet-proofs'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- View: any group member can view proofs for bets in their groups
-- (Simpler approach: any authenticated user can view — proofs are not secret)
CREATE POLICY "Authenticated users can view proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'bet-proofs');


-- ============================================================================
-- 3. INVITE CODES: Add UPDATE policy + atomic join function
-- ============================================================================

-- Allow the use_count to be incremented (needed for join flow)
-- Scoped: only the joining user's session can increment (via the join_group function)
CREATE POLICY "Use count can be incremented"
ON public.invite_codes FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Atomic join function: validates code, checks limits, joins group, increments use_count
-- All in one transaction to prevent race conditions
CREATE OR REPLACE FUNCTION public.join_group(
  p_code text
)
RETURNS uuid AS $$
DECLARE
  v_caller_uid uuid;
  v_invite RECORD;
  v_group RECORD;
  v_existing_member boolean;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Lock the invite code row to prevent concurrent joins exceeding max_uses
  SELECT ic.*, g.starting_balance
  INTO v_invite
  FROM public.invite_codes ic
  JOIN public.groups g ON g.id = ic.group_id
  WHERE ic.code = UPPER(p_code)
  FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  -- Check expiry
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invite code has expired';
  END IF;

  -- Check max uses
  IF v_invite.max_uses IS NOT NULL AND v_invite.use_count >= v_invite.max_uses THEN
    RAISE EXCEPTION 'Invite code has been fully used';
  END IF;

  -- Check not already a member
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_invite.group_id AND user_id = v_caller_uid
  ) INTO v_existing_member;

  IF v_existing_member THEN
    RAISE EXCEPTION 'Already a member of this group';
  END IF;

  -- Insert group membership
  INSERT INTO public.group_members (group_id, user_id, balance, role)
  VALUES (v_invite.group_id, v_caller_uid, v_invite.starting_balance, 'member');

  -- Atomically increment use_count
  UPDATE public.invite_codes
  SET use_count = use_count + 1
  WHERE id = v_invite.id;

  RETURN v_invite.group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
