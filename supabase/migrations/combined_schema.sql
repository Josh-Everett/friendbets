-- ============================================================================
-- COMBINED SCHEMA: All migrations (001-006) for FriendBets
-- Run this in the Supabase SQL Editor as a single script.
-- ============================================================================


-- ============================================================================
-- 001_initial_schema.sql
-- ============================================================================

-- 1. TABLES

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  currency_name text NOT NULL DEFAULT 'Coins',
  currency_symbol text NOT NULL DEFAULT '🪙',
  starting_balance integer NOT NULL DEFAULT 1000,
  created_by uuid REFERENCES public.profiles(id) NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  balance integer NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);

CREATE TABLE public.invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  code text UNIQUE NOT NULL,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  created_by uuid REFERENCES public.profiles(id) NOT NULL,
  title text NOT NULL,
  description text,
  subject_user_id uuid REFERENCES public.profiles(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'resolved', 'cancelled')),
  resolution_method text NOT NULL DEFAULT 'creator' CHECK (resolution_method IN ('creator', 'vote')),
  outcome boolean,
  deadline timestamptz,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE public.bet_wagers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id uuid REFERENCES public.bets(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) NOT NULL,
  side text NOT NULL CHECK (side IN ('for', 'against')),
  amount integer NOT NULL CHECK (amount > 0),
  payout integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(bet_id, user_id)
);

CREATE TABLE public.bet_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id uuid REFERENCES public.bets(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) NOT NULL,
  vote boolean NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(bet_id, user_id)
);

CREATE TABLE public.bet_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id uuid REFERENCES public.bets(id) ON DELETE CASCADE NOT NULL,
  uploaded_by uuid REFERENCES public.profiles(id) NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('image', 'video')),
  caption text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  description text,
  bet_id uuid REFERENCES public.bets(id),
  created_at timestamptz DEFAULT now()
);


-- ============================================================================
-- 001: TRIGGER — Auto-create profile on signup
-- ============================================================================

-- Note: This gets replaced by 006 with username collision handling.
-- We create the initial version here so the trigger exists, then 006 overwrites it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================================
-- 001: DATABASE FUNCTIONS (initial versions, replaced by later migrations)
-- ============================================================================

-- place_wager (will be dropped by 003 and replaced by buy_shares)
CREATE OR REPLACE FUNCTION public.place_wager(
  p_bet_id uuid,
  p_user_id uuid,
  p_side text,
  p_amount integer
)
RETURNS uuid AS $$
DECLARE
  v_group_id uuid;
  v_bet_status text;
  v_existing_wager uuid;
  v_current_balance integer;
  v_wager_id uuid;
BEGIN
  SELECT group_id, status INTO v_group_id, v_bet_status
  FROM public.bets WHERE id = p_bet_id;

  IF v_group_id IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF v_bet_status <> 'open' THEN RAISE EXCEPTION 'Bet is not open for wagers (status: %)', v_bet_status; END IF;

  SELECT balance INTO v_current_balance
  FROM public.group_members WHERE group_id = v_group_id AND user_id = p_user_id;
  IF v_current_balance IS NULL THEN RAISE EXCEPTION 'User is not a member of this group'; END IF;

  SELECT id INTO v_existing_wager FROM public.bet_wagers WHERE bet_id = p_bet_id AND user_id = p_user_id;
  IF v_existing_wager IS NOT NULL THEN RAISE EXCEPTION 'User has already placed a wager on this bet'; END IF;

  IF v_current_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %', v_current_balance, p_amount; END IF;

  UPDATE public.group_members SET balance = balance - p_amount WHERE group_id = v_group_id AND user_id = p_user_id;

  INSERT INTO public.bet_wagers (bet_id, user_id, side, amount)
  VALUES (p_bet_id, p_user_id, p_side, p_amount)
  RETURNING id INTO v_wager_id;

  RETURN v_wager_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- resolve_bet (will be dropped by 003 and replaced by resolve_market)
CREATE OR REPLACE FUNCTION public.resolve_bet(
  p_bet_id uuid,
  p_outcome boolean,
  p_resolved_by uuid
)
RETURNS void AS $$
DECLARE
  v_bet RECORD;
  v_winner_side text;
  v_loser_side text;
  v_winner_pool bigint;
  v_loser_pool bigint;
  v_total_pool bigint;
  v_wager RECORD;
BEGIN
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;
  IF v_bet.id IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF v_bet.status NOT IN ('open', 'locked') THEN RAISE EXCEPTION 'Bet cannot be resolved (status: %)', v_bet.status; END IF;

  IF p_outcome = true THEN v_winner_side := 'for'; v_loser_side := 'against';
  ELSE v_winner_side := 'against'; v_loser_side := 'for'; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_winner_pool FROM public.bet_wagers WHERE bet_id = p_bet_id AND side = v_winner_side;
  SELECT COALESCE(SUM(amount), 0) INTO v_loser_pool FROM public.bet_wagers WHERE bet_id = p_bet_id AND side = v_loser_side;
  v_total_pool := v_winner_pool + v_loser_pool;

  UPDATE public.bets SET status = 'resolved', outcome = p_outcome, resolved_at = now() WHERE id = p_bet_id;

  IF v_winner_pool > 0 THEN
    FOR v_wager IN SELECT id, user_id, amount FROM public.bet_wagers WHERE bet_id = p_bet_id AND side = v_winner_side
    LOOP
      DECLARE v_payout integer;
      BEGIN
        v_payout := v_wager.amount + (v_wager.amount::bigint * v_loser_pool / v_winner_pool)::integer;
        UPDATE public.bet_wagers SET payout = v_payout WHERE id = v_wager.id;
        UPDATE public.group_members SET balance = balance + v_payout WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id;
      END;
    END LOOP;
  END IF;

  UPDATE public.bet_wagers SET payout = 0 WHERE bet_id = p_bet_id AND side = v_loser_side;

  IF v_bet.subject_user_id IS NOT NULL AND p_outcome = true AND v_bet.subject_user_id <> v_bet.created_by THEN
    UPDATE public.group_members SET balance = balance + v_total_pool::integer
    WHERE group_id = v_bet.group_id AND user_id = v_bet.subject_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- cancel_bet (initial version, replaced later)
CREATE OR REPLACE FUNCTION public.cancel_bet(
  p_bet_id uuid
)
RETURNS void AS $$
DECLARE
  v_bet RECORD;
  v_wager RECORD;
BEGIN
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;
  IF v_bet.id IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;

  UPDATE public.bets SET status = 'cancelled' WHERE id = p_bet_id;

  FOR v_wager IN SELECT id, user_id, amount FROM public.bet_wagers WHERE bet_id = p_bet_id
  LOOP
    UPDATE public.group_members SET balance = balance + v_wager.amount WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id;
    UPDATE public.bet_wagers SET payout = v_wager.amount WHERE id = v_wager.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 001: ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_wagers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Profiles are viewable by authenticated users"
ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- groups
CREATE POLICY "Members can view their groups"
ON public.groups FOR SELECT TO authenticated
USING (id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY "Authenticated users can create groups"
ON public.groups FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

-- group_members (initial insert policy, replaced by 006)
CREATE POLICY "Admins and creators can add members"
ON public.group_members FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = group_members.group_id AND user_id = auth.uid() AND role = 'admin'
  )
  OR user_id = auth.uid()
);

CREATE POLICY "Members can see group members"
ON public.group_members FOR SELECT TO authenticated
USING (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY "Admins can update member roles"
ON public.group_members FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid() AND gm.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid() AND gm.role = 'admin'));

CREATE POLICY "Admins can remove members"
ON public.group_members FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid() AND gm.role = 'admin'));

-- invite_codes
CREATE POLICY "Group members can view invite codes"
ON public.invite_codes FOR SELECT TO authenticated
USING (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY "Group admins can create invite codes"
ON public.invite_codes FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.group_members WHERE group_id = invite_codes.group_id AND user_id = auth.uid() AND role = 'admin'));

-- bets
CREATE POLICY "Group members can view bets"
ON public.bets FOR SELECT TO authenticated
USING (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY "Group members can create bets"
ON public.bets FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.group_members WHERE group_id = bets.group_id AND user_id = auth.uid())
  AND created_by = auth.uid()
);

CREATE POLICY "Bet creator or admin can update bets"
ON public.bets FOR UPDATE TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.group_members WHERE group_id = bets.group_id AND user_id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  created_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.group_members WHERE group_id = bets.group_id AND user_id = auth.uid() AND role = 'admin')
);

-- bet_wagers
CREATE POLICY "Group members can view wagers"
ON public.bet_wagers FOR SELECT TO authenticated
USING (bet_id IN (SELECT b.id FROM public.bets b JOIN public.group_members gm ON gm.group_id = b.group_id WHERE gm.user_id = auth.uid()));

CREATE POLICY "Wagers are placed via place_wager function"
ON public.bet_wagers FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- bet_votes
CREATE POLICY "Group members can view votes"
ON public.bet_votes FOR SELECT TO authenticated
USING (bet_id IN (SELECT b.id FROM public.bets b JOIN public.group_members gm ON gm.group_id = b.group_id WHERE gm.user_id = auth.uid()));

CREATE POLICY "Group members can vote"
ON public.bet_votes FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.bets b JOIN public.group_members gm ON gm.group_id = b.group_id WHERE b.id = bet_votes.bet_id AND gm.user_id = auth.uid())
);

-- bet_proofs
CREATE POLICY "Group members can view proofs"
ON public.bet_proofs FOR SELECT TO authenticated
USING (bet_id IN (SELECT b.id FROM public.bets b JOIN public.group_members gm ON gm.group_id = b.group_id WHERE gm.user_id = auth.uid()));

CREATE POLICY "Group members can upload proofs"
ON public.bet_proofs FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.bets b JOIN public.group_members gm ON gm.group_id = b.group_id WHERE b.id = bet_proofs.bet_id AND gm.user_id = auth.uid())
);

-- achievements
CREATE POLICY "Group members can view achievements"
ON public.achievements FOR SELECT TO authenticated
USING (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));


-- ============================================================================
-- 001: INDEXES
-- ============================================================================

CREATE INDEX idx_group_members_group_id ON public.group_members(group_id);
CREATE INDEX idx_group_members_user_id ON public.group_members(user_id);
CREATE INDEX idx_bets_group_id ON public.bets(group_id);
CREATE INDEX idx_bets_status ON public.bets(status);
CREATE INDEX idx_bet_wagers_bet_id ON public.bet_wagers(bet_id);
CREATE INDEX idx_bet_wagers_user_id ON public.bet_wagers(user_id);
CREATE INDEX idx_invite_codes_code ON public.invite_codes(code);
CREATE INDEX idx_achievements_group_user ON public.achievements(group_id, user_id);


-- ============================================================================
-- 002_storage.sql — Storage policies for bet-proofs bucket
-- NOTE: Create the "bet-proofs" bucket in the dashboard FIRST, then run this.
--       These policies get replaced by 005 with tighter scoping.
-- ============================================================================

CREATE POLICY "Users can upload proofs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'bet-proofs');

CREATE POLICY "Users can view proofs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'bet-proofs');


-- ============================================================================
-- 003_amm_market_making.sql — AMM tables, columns, functions, economy features
-- ============================================================================

-- New tables

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  type text NOT NULL CHECK (type IN (
    'wager_placed', 'bet_payout', 'bet_refund',
    'daily_allowance', 'season_reset', 'subject_bonus'
  )),
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  reference_type text,
  reference_id uuid,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  season_number integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  rankings jsonb,
  total_volume integer DEFAULT 0,
  total_bets integer DEFAULT 0,
  mvp_user_id uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

-- Alter existing tables

ALTER TABLE public.groups
  ADD COLUMN reset_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (reset_frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly'));

ALTER TABLE public.groups ADD COLUMN season_end_at timestamptz;
ALTER TABLE public.groups ADD COLUMN current_season_number integer NOT NULL DEFAULT 1;

ALTER TABLE public.group_members ADD COLUMN last_allowance_at timestamptz DEFAULT now();

ALTER TABLE public.bets ADD COLUMN virtual_liquidity integer NOT NULL DEFAULT 500;
ALTER TABLE public.bets ADD COLUMN yes_pool numeric NOT NULL DEFAULT 500;
ALTER TABLE public.bets ADD COLUMN no_pool numeric NOT NULL DEFAULT 500;
ALTER TABLE public.bets ADD COLUMN k numeric NOT NULL DEFAULT 250000;
ALTER TABLE public.bets ADD COLUMN creator_side text CHECK (creator_side IN ('for', 'against'));
ALTER TABLE public.bets ADD COLUMN creator_wager_amount integer CHECK (creator_wager_amount > 0);

ALTER TABLE public.bet_wagers ADD COLUMN shares numeric NOT NULL DEFAULT 0;
ALTER TABLE public.bet_wagers ADD COLUMN price_avg numeric NOT NULL DEFAULT 0;

-- Remove unique constraint to allow multiple wagers per user per bet (same side)
ALTER TABLE public.bet_wagers DROP CONSTRAINT IF EXISTS bet_wagers_bet_id_user_id_key;

-- Drop old functions
DROP FUNCTION IF EXISTS public.place_wager(uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS public.resolve_bet(uuid, boolean, uuid);

-- New functions (initial versions, replaced by 004/005/006)

CREATE OR REPLACE FUNCTION public.buy_shares(
  p_bet_id uuid, p_user_id uuid, p_side text, p_amount integer
)
RETURNS TABLE(wager_id uuid, shares_received numeric, avg_price numeric) AS $$
DECLARE
  v_bet RECORD; v_current_balance integer; v_existing_side text;
  v_shares numeric; v_new_yes numeric; v_new_no numeric;
  v_avg_price numeric; v_wager_id uuid; v_new_balance integer;
BEGIN
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id FOR UPDATE;
  IF v_bet.id IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF v_bet.status <> 'open' THEN RAISE EXCEPTION 'Bet is not open for wagers (status: %)', v_bet.status; END IF;

  SELECT gm.balance INTO v_current_balance FROM public.group_members gm
  WHERE gm.group_id = v_bet.group_id AND gm.user_id = p_user_id;
  IF v_current_balance IS NULL THEN RAISE EXCEPTION 'User is not a member of this group'; END IF;
  IF v_current_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %', v_current_balance, p_amount; END IF;

  SELECT DISTINCT bw.side INTO v_existing_side FROM public.bet_wagers bw WHERE bw.bet_id = p_bet_id AND bw.user_id = p_user_id LIMIT 1;
  IF v_existing_side IS NOT NULL AND v_existing_side <> p_side THEN RAISE EXCEPTION 'Cannot bet on both sides. You already bet %', v_existing_side; END IF;

  IF p_side = 'for' THEN
    v_new_no := v_bet.no_pool + p_amount; v_new_yes := v_bet.k / v_new_no; v_shares := v_bet.yes_pool - v_new_yes;
  ELSE
    v_new_yes := v_bet.yes_pool + p_amount; v_new_no := v_bet.k / v_new_yes; v_shares := v_bet.no_pool - v_new_no;
  END IF;

  IF v_shares <= 0 THEN RAISE EXCEPTION 'Trade too small, no shares received'; END IF;
  v_avg_price := p_amount::numeric / v_shares;

  UPDATE public.bets SET yes_pool = v_new_yes, no_pool = v_new_no WHERE id = p_bet_id;
  v_new_balance := v_current_balance - p_amount;
  UPDATE public.group_members SET balance = v_new_balance WHERE group_id = v_bet.group_id AND user_id = p_user_id;

  INSERT INTO public.bet_wagers (bet_id, user_id, side, amount, shares, price_avg)
  VALUES (p_bet_id, p_user_id, p_side, p_amount, v_shares, v_avg_price)
  RETURNING id INTO v_wager_id;

  INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES (v_bet.group_id, p_user_id, 'wager_placed', -p_amount, v_new_balance, 'wager', v_wager_id,
    'Bought ' || ROUND(v_shares, 2) || ' ' || p_side || ' shares on "' || LEFT(v_bet.title, 50) || '"');

  RETURN QUERY SELECT v_wager_id, v_shares, v_avg_price;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.resolve_market(
  p_bet_id uuid, p_outcome boolean, p_resolved_by uuid
)
RETURNS void AS $$
DECLARE
  v_bet RECORD; v_winner_side text; v_total_pot bigint;
  v_total_winner_shares numeric; v_payout_per_share numeric;
  v_wager RECORD; v_payout integer; v_member_balance integer;
BEGIN
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;
  IF v_bet.id IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF v_bet.status NOT IN ('open', 'locked') THEN RAISE EXCEPTION 'Bet cannot be resolved (status: %)', v_bet.status; END IF;

  v_winner_side := CASE WHEN p_outcome THEN 'for' ELSE 'against' END;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_pot FROM public.bet_wagers WHERE bet_id = p_bet_id;
  SELECT COALESCE(SUM(shares), 0) INTO v_total_winner_shares FROM public.bet_wagers WHERE bet_id = p_bet_id AND side = v_winner_side;

  UPDATE public.bets SET status = 'resolved', outcome = p_outcome, resolved_at = now() WHERE id = p_bet_id;

  IF v_total_winner_shares > 0 THEN
    v_payout_per_share := v_total_pot::numeric / v_total_winner_shares;
    FOR v_wager IN SELECT id, user_id, shares FROM public.bet_wagers WHERE bet_id = p_bet_id AND side = v_winner_side
    LOOP
      v_payout := FLOOR(v_wager.shares * v_payout_per_share)::integer;
      UPDATE public.bet_wagers SET payout = v_payout WHERE id = v_wager.id;
      UPDATE public.group_members SET balance = balance + v_payout WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id RETURNING balance INTO v_member_balance;
      INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
      VALUES (v_bet.group_id, v_wager.user_id, 'bet_payout', v_payout, v_member_balance, 'bet', p_bet_id,
        'Won ' || v_payout || ' from "' || LEFT(v_bet.title, 50) || '"');
    END LOOP;
  END IF;

  UPDATE public.bet_wagers SET payout = 0 WHERE bet_id = p_bet_id AND side <> v_winner_side;

  IF v_bet.subject_user_id IS NOT NULL AND p_outcome = true AND v_bet.subject_user_id <> v_bet.created_by THEN
    UPDATE public.group_members SET balance = balance + v_total_pot::integer
    WHERE group_id = v_bet.group_id AND user_id = v_bet.subject_user_id RETURNING balance INTO v_member_balance;
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (v_bet.group_id, v_bet.subject_user_id, 'subject_bonus', v_total_pot::integer, v_member_balance,
      'bet', p_bet_id, 'Subject bonus from "' || LEFT(v_bet.title, 50) || '"');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.create_market(
  p_group_id uuid, p_created_by uuid, p_title text, p_description text,
  p_subject_user_id uuid, p_resolution_method text, p_deadline timestamptz,
  p_virtual_liquidity integer, p_creator_side text, p_creator_amount integer
)
RETURNS uuid AS $$
DECLARE
  v_bet_id uuid; v_k numeric; v_is_member boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND user_id = p_created_by) INTO v_is_member;
  IF NOT v_is_member THEN RAISE EXCEPTION 'User is not a member of this group'; END IF;

  v_k := p_virtual_liquidity::numeric * p_virtual_liquidity::numeric;

  INSERT INTO public.bets (
    group_id, created_by, title, description, subject_user_id,
    resolution_method, deadline, virtual_liquidity, yes_pool, no_pool, k, creator_side, creator_wager_amount
  ) VALUES (
    p_group_id, p_created_by, p_title, p_description, p_subject_user_id,
    p_resolution_method, p_deadline, p_virtual_liquidity,
    p_virtual_liquidity, p_virtual_liquidity, v_k, p_creator_side, p_creator_amount
  ) RETURNING id INTO v_bet_id;

  PERFORM public.buy_shares(v_bet_id, p_created_by, p_creator_side, p_creator_amount);
  RETURN v_bet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- cancel_bet: updated with transaction logging
CREATE OR REPLACE FUNCTION public.cancel_bet(
  p_bet_id uuid
)
RETURNS void AS $$
DECLARE
  v_bet RECORD; v_wager RECORD; v_member_balance integer;
BEGIN
  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;
  IF v_bet.id IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF v_bet.status IN ('resolved', 'cancelled') THEN RAISE EXCEPTION 'Bet cannot be cancelled (status: %)', v_bet.status; END IF;

  UPDATE public.bets SET status = 'cancelled' WHERE id = p_bet_id;

  FOR v_wager IN SELECT id, user_id, amount FROM public.bet_wagers WHERE bet_id = p_bet_id
  LOOP
    UPDATE public.group_members SET balance = balance + v_wager.amount
    WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id RETURNING balance INTO v_member_balance;
    UPDATE public.bet_wagers SET payout = v_wager.amount WHERE id = v_wager.id;
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (v_bet.group_id, v_wager.user_id, 'bet_refund', v_wager.amount, v_member_balance,
      'wager', v_wager.id, 'Refund from cancelled bet "' || LEFT(v_bet.title, 50) || '"');
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.credit_daily_allowance(
  p_group_id uuid, p_user_id uuid
)
RETURNS integer AS $$
DECLARE
  v_member RECORD; v_group RECORD; v_allowance integer; v_new_balance integer;
BEGIN
  SELECT * INTO v_member FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id;
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'User is not a member of this group'; END IF;
  IF v_member.last_allowance_at IS NOT NULL AND v_member.last_allowance_at > now() - interval '24 hours' THEN RETURN 0; END IF;

  SELECT * INTO v_group FROM public.groups WHERE id = p_group_id;
  v_allowance := FLOOR(v_group.starting_balance * 0.05)::integer;
  IF v_allowance <= 0 THEN RETURN 0; END IF;

  v_new_balance := v_member.balance + v_allowance;
  UPDATE public.group_members SET balance = v_new_balance, last_allowance_at = now()
  WHERE group_id = p_group_id AND user_id = p_user_id;

  INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES (p_group_id, p_user_id, 'daily_allowance', v_allowance, v_new_balance,
    'group', p_group_id, 'Daily allowance of ' || v_allowance || ' ' || v_group.currency_name);

  RETURN v_allowance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.reset_season(p_group_id uuid)
RETURNS boolean AS $$
DECLARE
  v_group RECORD; v_rankings jsonb; v_mvp_user_id uuid;
  v_total_volume integer; v_total_bets integer;
  v_new_season_end timestamptz; v_member RECORD; v_active_bet RECORD;
BEGIN
  SELECT * INTO v_group FROM public.groups WHERE id = p_group_id;
  IF v_group.id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF v_group.season_end_at IS NULL OR now() <= v_group.season_end_at THEN RETURN false; END IF;

  SELECT jsonb_agg(
    jsonb_build_object('user_id', gm.user_id, 'username', p.username, 'display_name', p.display_name,
      'final_balance', gm.balance, 'profit', gm.balance - v_group.starting_balance,
      'rank', ROW_NUMBER() OVER (ORDER BY gm.balance DESC))
    ORDER BY gm.balance DESC
  ) INTO v_rankings
  FROM public.group_members gm JOIN public.profiles p ON p.id = gm.user_id WHERE gm.group_id = p_group_id;

  SELECT gm.user_id INTO v_mvp_user_id FROM public.group_members gm WHERE gm.group_id = p_group_id ORDER BY gm.balance DESC LIMIT 1;

  SELECT COALESCE(SUM(bw.amount), 0), COUNT(DISTINCT b.id) INTO v_total_volume, v_total_bets
  FROM public.bets b LEFT JOIN public.bet_wagers bw ON bw.bet_id = b.id
  WHERE b.group_id = p_group_id AND b.created_at >= COALESCE(v_group.season_end_at - (
    CASE v_group.reset_frequency WHEN 'weekly' THEN interval '7 days' WHEN 'biweekly' THEN interval '14 days'
    WHEN 'monthly' THEN interval '30 days' WHEN 'quarterly' THEN interval '90 days' END), v_group.created_at);

  INSERT INTO public.seasons (group_id, season_number, started_at, ended_at, rankings, total_volume, total_bets, mvp_user_id)
  VALUES (p_group_id, v_group.current_season_number,
    COALESCE(v_group.season_end_at - (CASE v_group.reset_frequency WHEN 'weekly' THEN interval '7 days'
      WHEN 'biweekly' THEN interval '14 days' WHEN 'monthly' THEN interval '30 days'
      WHEN 'quarterly' THEN interval '90 days' END), v_group.created_at),
    now(), v_rankings, v_total_volume, v_total_bets, v_mvp_user_id);

  FOR v_active_bet IN SELECT id FROM public.bets WHERE group_id = p_group_id AND status IN ('open', 'locked')
  LOOP PERFORM public.cancel_bet(v_active_bet.id); END LOOP;

  FOR v_member IN SELECT user_id FROM public.group_members WHERE group_id = p_group_id
  LOOP
    UPDATE public.group_members SET balance = v_group.starting_balance, last_allowance_at = now()
    WHERE group_id = p_group_id AND user_id = v_member.user_id;
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (p_group_id, v_member.user_id, 'season_reset', 0, v_group.starting_balance,
      'season', (SELECT id FROM public.seasons WHERE group_id = p_group_id AND season_number = v_group.current_season_number),
      'Season ' || v_group.current_season_number || ' reset — balance restored to ' || v_group.starting_balance);
  END LOOP;

  v_new_season_end := v_group.season_end_at + (CASE v_group.reset_frequency
    WHEN 'weekly' THEN interval '7 days' WHEN 'biweekly' THEN interval '14 days'
    WHEN 'monthly' THEN interval '30 days' WHEN 'quarterly' THEN interval '90 days' END);
  WHILE v_new_season_end <= now() LOOP
    v_new_season_end := v_new_season_end + (CASE v_group.reset_frequency
      WHEN 'weekly' THEN interval '7 days' WHEN 'biweekly' THEN interval '14 days'
      WHEN 'monthly' THEN interval '30 days' WHEN 'quarterly' THEN interval '90 days' END);
  END LOOP;

  UPDATE public.groups SET season_end_at = v_new_season_end, current_season_number = current_season_number + 1 WHERE id = p_group_id;
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- RLS for new tables
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group members can view transactions"
ON public.transactions FOR SELECT TO authenticated
USING (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY "Group members can view seasons"
ON public.seasons FOR SELECT TO authenticated
USING (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

-- Indexes for new tables
CREATE INDEX idx_transactions_group_user ON public.transactions(group_id, user_id);
CREATE INDEX idx_transactions_reference ON public.transactions(reference_type, reference_id);
CREATE INDEX idx_transactions_created ON public.transactions(created_at);
CREATE INDEX idx_seasons_group ON public.seasons(group_id);


-- ============================================================================
-- 004_security_hardening.sql — auth.uid() validation, invite code fix, balance constraint
-- ============================================================================

-- All SECURITY DEFINER functions are replaced with versions that validate auth.uid().
-- The final versions (from 006) are applied at the end of this script.
-- For now, apply the invite code policy and balance constraint.

-- Invite codes: allow non-members to look up codes (fixes join flow)
-- Drop the old restrictive policy first, then create permissive one
DROP POLICY IF EXISTS "Group members can view invite codes" ON public.invite_codes;

CREATE POLICY "Anyone can look up invite codes by code"
ON public.invite_codes FOR SELECT TO authenticated
USING (true);

-- Balance constraint
ALTER TABLE public.group_members
  ADD CONSTRAINT balance_non_negative CHECK (balance >= 0);


-- ============================================================================
-- 005_high_severity_fixes.sql — Bet financial guard trigger, storage tightening,
--                                atomic join_group function
-- ============================================================================

-- Bet financial column guard trigger
CREATE OR REPLACE FUNCTION public.guard_bet_financial_columns()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.bypass_bet_guard', true) = 'true' THEN RETURN NEW; END IF;

  IF NEW.yes_pool IS DISTINCT FROM OLD.yes_pool
     OR NEW.no_pool IS DISTINCT FROM OLD.no_pool
     OR NEW.k IS DISTINCT FROM OLD.k
     OR NEW.virtual_liquidity IS DISTINCT FROM OLD.virtual_liquidity
     OR NEW.outcome IS DISTINCT FROM OLD.outcome
     OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
  THEN
    RAISE EXCEPTION 'Cannot directly modify financial columns on bets';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('resolved', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot directly resolve or cancel bets — use the RPC functions';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_bet_financial_columns
  BEFORE UPDATE ON public.bets
  FOR EACH ROW EXECUTE FUNCTION public.guard_bet_financial_columns();

-- Storage: replace permissive policies with tighter ones
DROP POLICY IF EXISTS "Users can upload proofs" ON storage.objects;
DROP POLICY IF EXISTS "Users can view proofs" ON storage.objects;

CREATE POLICY "Users can upload proofs to own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'bet-proofs'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

CREATE POLICY "Authenticated users can view proofs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'bet-proofs');

-- Invite codes: UPDATE policy for use_count increment
CREATE POLICY "Use count can be incremented"
ON public.invite_codes FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);

-- Atomic join_group function
CREATE OR REPLACE FUNCTION public.join_group(p_code text)
RETURNS uuid AS $$
DECLARE
  v_caller_uid uuid; v_invite RECORD; v_existing_member boolean;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT ic.*, g.starting_balance INTO v_invite
  FROM public.invite_codes ic JOIN public.groups g ON g.id = ic.group_id
  WHERE ic.code = UPPER(p_code) FOR UPDATE;

  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'Invalid invite code'; END IF;
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN RAISE EXCEPTION 'Invite code has expired'; END IF;
  IF v_invite.max_uses IS NOT NULL AND v_invite.use_count >= v_invite.max_uses THEN RAISE EXCEPTION 'Invite code has been fully used'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = v_invite.group_id AND user_id = v_caller_uid) INTO v_existing_member;
  IF v_existing_member THEN RAISE EXCEPTION 'Already a member of this group'; END IF;

  INSERT INTO public.group_members (group_id, user_id, balance, role)
  VALUES (v_invite.group_id, v_caller_uid, v_invite.starting_balance, 'member');

  UPDATE public.invite_codes SET use_count = use_count + 1 WHERE id = v_invite.id;

  RETURN v_invite.group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 006_medium_severity_fixes.sql — Final versions of all functions, member guard,
--                                  group policies, atomic create_group
-- ============================================================================

-- Replace group_members insert policy
DROP POLICY IF EXISTS "Admins and creators can add members" ON public.group_members;

CREATE POLICY "Admins can add members"
ON public.group_members FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid() AND gm.role = 'admin'
  )
);

-- Replace group_members update policy
DROP POLICY IF EXISTS "Admins can update member roles" ON public.group_members;

CREATE POLICY "Admins can update members"
ON public.group_members FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid() AND gm.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_members.group_id AND gm.user_id = auth.uid() AND gm.role = 'admin'));

-- Member balance guard trigger
CREATE OR REPLACE FUNCTION public.guard_member_balance()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.bypass_member_guard', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.balance IS DISTINCT FROM OLD.balance THEN RAISE EXCEPTION 'Cannot directly modify member balance — use RPC functions'; END IF;
  IF NEW.last_allowance_at IS DISTINCT FROM OLD.last_allowance_at THEN RAISE EXCEPTION 'Cannot directly modify allowance tracking'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_member_balance
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_balance();


-- ============================================================================
-- FINAL VERSIONS OF ALL SECURITY DEFINER FUNCTIONS
-- (with auth.uid() checks, bypass flags for both guards, rounding fix)
-- ============================================================================

-- buy_shares (FINAL)
CREATE OR REPLACE FUNCTION public.buy_shares(
  p_bet_id uuid, p_user_id uuid, p_side text, p_amount integer
)
RETURNS TABLE(wager_id uuid, shares_received numeric, avg_price numeric) AS $$
DECLARE
  v_bet RECORD; v_current_balance integer; v_existing_side text;
  v_shares numeric; v_new_yes numeric; v_new_no numeric;
  v_avg_price numeric; v_wager_id uuid; v_new_balance integer; v_caller_uid uuid;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match user_id';
  END IF;

  PERFORM set_config('app.bypass_bet_guard', 'true', true);
  PERFORM set_config('app.bypass_member_guard', 'true', true);

  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id FOR UPDATE;
  IF v_bet.id IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF v_bet.status <> 'open' THEN RAISE EXCEPTION 'Bet is not open for wagers'; END IF;

  SELECT gm.balance INTO v_current_balance FROM public.group_members gm
  WHERE gm.group_id = v_bet.group_id AND gm.user_id = p_user_id FOR UPDATE;
  IF v_current_balance IS NULL THEN RAISE EXCEPTION 'User is not a member of this group'; END IF;
  IF v_current_balance < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

  SELECT DISTINCT bw.side INTO v_existing_side FROM public.bet_wagers bw
  WHERE bw.bet_id = p_bet_id AND bw.user_id = p_user_id LIMIT 1;
  IF v_existing_side IS NOT NULL AND v_existing_side <> p_side THEN RAISE EXCEPTION 'Cannot bet on both sides'; END IF;

  IF p_side = 'for' THEN
    v_new_no := v_bet.no_pool + p_amount; v_new_yes := v_bet.k / v_new_no; v_shares := v_bet.yes_pool - v_new_yes;
  ELSE
    v_new_yes := v_bet.yes_pool + p_amount; v_new_no := v_bet.k / v_new_yes; v_shares := v_bet.no_pool - v_new_no;
  END IF;

  IF v_shares <= 0 THEN RAISE EXCEPTION 'Trade too small, no shares received'; END IF;
  v_avg_price := p_amount::numeric / v_shares;

  UPDATE public.bets SET yes_pool = v_new_yes, no_pool = v_new_no WHERE id = p_bet_id;
  v_new_balance := v_current_balance - p_amount;
  UPDATE public.group_members SET balance = v_new_balance WHERE group_id = v_bet.group_id AND user_id = p_user_id;

  INSERT INTO public.bet_wagers (bet_id, user_id, side, amount, shares, price_avg)
  VALUES (p_bet_id, p_user_id, p_side, p_amount, v_shares, v_avg_price)
  RETURNING id INTO v_wager_id;

  INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES (v_bet.group_id, p_user_id, 'wager_placed', -p_amount, v_new_balance, 'wager', v_wager_id,
    'Bought ' || ROUND(v_shares, 2) || ' ' || p_side || ' shares on "' || LEFT(v_bet.title, 50) || '"');

  RETURN QUERY SELECT v_wager_id, v_shares, v_avg_price;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- resolve_market (FINAL — with rounding remainder fix)
CREATE OR REPLACE FUNCTION public.resolve_market(
  p_bet_id uuid, p_outcome boolean, p_resolved_by uuid
)
RETURNS void AS $$
DECLARE
  v_bet RECORD; v_caller_uid uuid; v_is_authorized boolean;
  v_winner_side text; v_total_pot bigint; v_total_winner_shares numeric;
  v_payout_per_share numeric; v_wager RECORD; v_payout integer; v_member_balance integer;
  v_total_paid integer := 0; v_remainder integer;
  v_largest_wager_id uuid; v_largest_shares numeric := 0;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_resolved_by THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match resolved_by';
  END IF;

  PERFORM set_config('app.bypass_bet_guard', 'true', true);
  PERFORM set_config('app.bypass_member_guard', 'true', true);

  SELECT * INTO v_bet FROM public.bets WHERE id = p_bet_id;
  IF v_bet.id IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF v_bet.status NOT IN ('open', 'locked') THEN RAISE EXCEPTION 'Bet cannot be resolved'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = v_bet.group_id AND user_id = v_caller_uid
      AND (v_bet.created_by = v_caller_uid OR role = 'admin')
  ) INTO v_is_authorized;
  IF NOT v_is_authorized THEN RAISE EXCEPTION 'Only the bet creator or a group admin can resolve this bet'; END IF;

  v_winner_side := CASE WHEN p_outcome THEN 'for' ELSE 'against' END;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_pot FROM public.bet_wagers WHERE bet_id = p_bet_id;
  SELECT COALESCE(SUM(shares), 0) INTO v_total_winner_shares FROM public.bet_wagers WHERE bet_id = p_bet_id AND side = v_winner_side;

  UPDATE public.bets SET status = 'resolved', outcome = p_outcome, resolved_at = now() WHERE id = p_bet_id;

  IF v_total_winner_shares > 0 THEN
    v_payout_per_share := v_total_pot::numeric / v_total_winner_shares;

    FOR v_wager IN SELECT id, user_id, shares FROM public.bet_wagers WHERE bet_id = p_bet_id AND side = v_winner_side
    LOOP
      v_payout := FLOOR(v_wager.shares * v_payout_per_share)::integer;
      v_total_paid := v_total_paid + v_payout;

      IF v_wager.shares > v_largest_shares THEN
        v_largest_shares := v_wager.shares; v_largest_wager_id := v_wager.id;
      END IF;

      UPDATE public.bet_wagers SET payout = v_payout WHERE id = v_wager.id;
      UPDATE public.group_members SET balance = balance + v_payout
      WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id RETURNING balance INTO v_member_balance;

      INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
      VALUES (v_bet.group_id, v_wager.user_id, 'bet_payout', v_payout, v_member_balance,
        'bet', p_bet_id, 'Won ' || v_payout || ' from "' || LEFT(v_bet.title, 50) || '"');
    END LOOP;

    -- Allocate rounding remainder to largest shareholder
    v_remainder := v_total_pot::integer - v_total_paid;
    IF v_remainder > 0 AND v_largest_wager_id IS NOT NULL THEN
      UPDATE public.bet_wagers SET payout = payout + v_remainder WHERE id = v_largest_wager_id;
      UPDATE public.group_members SET balance = balance + v_remainder
      WHERE group_id = v_bet.group_id
        AND user_id = (SELECT user_id FROM public.bet_wagers WHERE id = v_largest_wager_id)
      RETURNING balance INTO v_member_balance;
      INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
      VALUES (v_bet.group_id,
        (SELECT user_id FROM public.bet_wagers WHERE id = v_largest_wager_id),
        'bet_payout', v_remainder, v_member_balance, 'bet', p_bet_id,
        'Rounding remainder from "' || LEFT(v_bet.title, 50) || '"');
    END IF;
  END IF;

  UPDATE public.bet_wagers SET payout = 0 WHERE bet_id = p_bet_id AND side <> v_winner_side;

  IF v_bet.subject_user_id IS NOT NULL AND p_outcome = true AND v_bet.subject_user_id <> v_bet.created_by THEN
    UPDATE public.group_members SET balance = balance + v_total_pot::integer
    WHERE group_id = v_bet.group_id AND user_id = v_bet.subject_user_id RETURNING balance INTO v_member_balance;
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (v_bet.group_id, v_bet.subject_user_id, 'subject_bonus', v_total_pot::integer, v_member_balance,
      'bet', p_bet_id, 'Subject bonus from "' || LEFT(v_bet.title, 50) || '"');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- cancel_bet (FINAL — with auth, authorization, bypass flags, default param)
CREATE OR REPLACE FUNCTION public.cancel_bet(
  p_bet_id uuid, p_cancelled_by uuid DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_bet RECORD; v_caller_uid uuid; v_is_authorized boolean;
  v_wager RECORD; v_member_balance integer;
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
  IF v_bet.id IS NULL THEN RAISE EXCEPTION 'Bet not found'; END IF;
  IF v_bet.status IN ('resolved', 'cancelled') THEN RAISE EXCEPTION 'Bet cannot be cancelled'; END IF;

  IF p_cancelled_by IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_id = v_bet.group_id AND user_id = v_caller_uid
        AND (v_bet.created_by = v_caller_uid OR role = 'admin')
    ) INTO v_is_authorized;
    IF NOT v_is_authorized THEN RAISE EXCEPTION 'Only the bet creator or a group admin can cancel this bet'; END IF;
  END IF;

  UPDATE public.bets SET status = 'cancelled' WHERE id = p_bet_id;

  FOR v_wager IN SELECT id, user_id, amount FROM public.bet_wagers WHERE bet_id = p_bet_id
  LOOP
    UPDATE public.group_members SET balance = balance + v_wager.amount
    WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id RETURNING balance INTO v_member_balance;
    UPDATE public.bet_wagers SET payout = v_wager.amount WHERE id = v_wager.id;
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (v_bet.group_id, v_wager.user_id, 'bet_refund', v_wager.amount, v_member_balance,
      'wager', v_wager.id, 'Refund from cancelled bet "' || LEFT(v_bet.title, 50) || '"');
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- credit_daily_allowance (FINAL)
CREATE OR REPLACE FUNCTION public.credit_daily_allowance(
  p_group_id uuid, p_user_id uuid
)
RETURNS integer AS $$
DECLARE
  v_member RECORD; v_group RECORD; v_allowance integer; v_new_balance integer; v_caller_uid uuid;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match user_id';
  END IF;

  PERFORM set_config('app.bypass_member_guard', 'true', true);

  SELECT * INTO v_member FROM public.group_members WHERE group_id = p_group_id AND user_id = p_user_id;
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'User is not a member of this group'; END IF;
  IF v_member.last_allowance_at IS NOT NULL AND v_member.last_allowance_at > now() - interval '24 hours' THEN RETURN 0; END IF;

  SELECT * INTO v_group FROM public.groups WHERE id = p_group_id;
  v_allowance := FLOOR(v_group.starting_balance * 0.05)::integer;
  IF v_allowance <= 0 THEN RETURN 0; END IF;

  v_new_balance := v_member.balance + v_allowance;
  UPDATE public.group_members SET balance = v_new_balance, last_allowance_at = now()
  WHERE group_id = p_group_id AND user_id = p_user_id;

  INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
  VALUES (p_group_id, p_user_id, 'daily_allowance', v_allowance, v_new_balance,
    'group', p_group_id, 'Daily allowance of ' || v_allowance || ' ' || v_group.currency_name);

  RETURN v_allowance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- reset_season (FINAL)
CREATE OR REPLACE FUNCTION public.reset_season(p_group_id uuid)
RETURNS boolean AS $$
DECLARE
  v_group RECORD; v_caller_uid uuid; v_is_member boolean;
  v_rankings jsonb; v_mvp_user_id uuid;
  v_total_volume integer; v_total_bets integer;
  v_new_season_end timestamptz; v_member RECORD; v_active_bet RECORD;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized: not authenticated'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND user_id = v_caller_uid) INTO v_is_member;
  IF NOT v_is_member THEN RAISE EXCEPTION 'Unauthorized: not a member of this group'; END IF;

  PERFORM set_config('app.bypass_member_guard', 'true', true);

  SELECT * INTO v_group FROM public.groups WHERE id = p_group_id;
  IF v_group.id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF v_group.season_end_at IS NULL OR now() <= v_group.season_end_at THEN RETURN false; END IF;

  SELECT jsonb_agg(
    jsonb_build_object('user_id', gm.user_id, 'username', p.username, 'display_name', p.display_name,
      'final_balance', gm.balance, 'profit', gm.balance - v_group.starting_balance,
      'rank', ROW_NUMBER() OVER (ORDER BY gm.balance DESC))
    ORDER BY gm.balance DESC
  ) INTO v_rankings
  FROM public.group_members gm JOIN public.profiles p ON p.id = gm.user_id WHERE gm.group_id = p_group_id;

  SELECT gm.user_id INTO v_mvp_user_id FROM public.group_members gm WHERE gm.group_id = p_group_id ORDER BY gm.balance DESC LIMIT 1;

  SELECT COALESCE(SUM(bw.amount), 0), COUNT(DISTINCT b.id) INTO v_total_volume, v_total_bets
  FROM public.bets b LEFT JOIN public.bet_wagers bw ON bw.bet_id = b.id
  WHERE b.group_id = p_group_id AND b.created_at >= COALESCE(v_group.season_end_at - (
    CASE v_group.reset_frequency WHEN 'weekly' THEN interval '7 days' WHEN 'biweekly' THEN interval '14 days'
    WHEN 'monthly' THEN interval '30 days' WHEN 'quarterly' THEN interval '90 days' END), v_group.created_at);

  INSERT INTO public.seasons (group_id, season_number, started_at, ended_at, rankings, total_volume, total_bets, mvp_user_id)
  VALUES (p_group_id, v_group.current_season_number,
    COALESCE(v_group.season_end_at - (CASE v_group.reset_frequency WHEN 'weekly' THEN interval '7 days'
      WHEN 'biweekly' THEN interval '14 days' WHEN 'monthly' THEN interval '30 days'
      WHEN 'quarterly' THEN interval '90 days' END), v_group.created_at),
    now(), v_rankings, v_total_volume, v_total_bets, v_mvp_user_id);

  FOR v_active_bet IN SELECT id FROM public.bets WHERE group_id = p_group_id AND status IN ('open', 'locked')
  LOOP PERFORM public.cancel_bet(v_active_bet.id, NULL); END LOOP;

  FOR v_member IN SELECT user_id FROM public.group_members WHERE group_id = p_group_id
  LOOP
    UPDATE public.group_members SET balance = v_group.starting_balance, last_allowance_at = now()
    WHERE group_id = p_group_id AND user_id = v_member.user_id;
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (p_group_id, v_member.user_id, 'season_reset', 0, v_group.starting_balance,
      'season', (SELECT id FROM public.seasons WHERE group_id = p_group_id AND season_number = v_group.current_season_number),
      'Season ' || v_group.current_season_number || ' reset');
  END LOOP;

  v_new_season_end := v_group.season_end_at + (CASE v_group.reset_frequency
    WHEN 'weekly' THEN interval '7 days' WHEN 'biweekly' THEN interval '14 days'
    WHEN 'monthly' THEN interval '30 days' WHEN 'quarterly' THEN interval '90 days' END);
  WHILE v_new_season_end <= now() LOOP
    v_new_season_end := v_new_season_end + (CASE v_group.reset_frequency
      WHEN 'weekly' THEN interval '7 days' WHEN 'biweekly' THEN interval '14 days'
      WHEN 'monthly' THEN interval '30 days' WHEN 'quarterly' THEN interval '90 days' END);
  END LOOP;

  UPDATE public.groups SET season_end_at = v_new_season_end, current_season_number = current_season_number + 1 WHERE id = p_group_id;
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- create_market (FINAL — with auth, subject validation, bypass flag)
CREATE OR REPLACE FUNCTION public.create_market(
  p_group_id uuid, p_created_by uuid, p_title text, p_description text,
  p_subject_user_id uuid, p_resolution_method text, p_deadline timestamptz,
  p_virtual_liquidity integer, p_creator_side text, p_creator_amount integer
)
RETURNS uuid AS $$
DECLARE
  v_bet_id uuid; v_k numeric; v_is_member boolean;
  v_subject_is_member boolean; v_caller_uid uuid;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL OR v_caller_uid <> p_created_by THEN
    RAISE EXCEPTION 'Unauthorized: caller does not match created_by';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND user_id = p_created_by) INTO v_is_member;
  IF NOT v_is_member THEN RAISE EXCEPTION 'User is not a member of this group'; END IF;

  IF p_subject_user_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = p_group_id AND user_id = p_subject_user_id) INTO v_subject_is_member;
    IF NOT v_subject_is_member THEN RAISE EXCEPTION 'Subject user is not a member of this group'; END IF;
  END IF;

  IF p_virtual_liquidity IS NULL OR p_virtual_liquidity < 10 OR p_virtual_liquidity > 100000 THEN
    RAISE EXCEPTION 'Virtual liquidity must be between 10 and 100000';
  END IF;

  PERFORM set_config('app.bypass_bet_guard', 'true', true);

  v_k := p_virtual_liquidity::numeric * p_virtual_liquidity::numeric;

  INSERT INTO public.bets (
    group_id, created_by, title, description, subject_user_id,
    resolution_method, deadline, virtual_liquidity, yes_pool, no_pool, k, creator_side, creator_wager_amount
  ) VALUES (
    p_group_id, p_created_by, p_title, p_description, p_subject_user_id,
    p_resolution_method, p_deadline, p_virtual_liquidity,
    p_virtual_liquidity, p_virtual_liquidity, v_k, p_creator_side, p_creator_amount
  ) RETURNING id INTO v_bet_id;

  PERFORM public.buy_shares(v_bet_id, p_created_by, p_creator_side, p_creator_amount);
  RETURN v_bet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 006: Additional policies
-- ============================================================================

-- Groups UPDATE policy for admins
CREATE POLICY "Group admins can update group settings"
ON public.groups FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.group_members WHERE group_id = groups.id AND user_id = auth.uid() AND role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.group_members WHERE group_id = groups.id AND user_id = auth.uid() AND role = 'admin'));

-- Invite codes DELETE policy for admins
CREATE POLICY "Group admins can delete invite codes"
ON public.invite_codes FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.group_members WHERE group_id = invite_codes.group_id AND user_id = auth.uid() AND role = 'admin'));

-- handle_new_user (FINAL — with username collision handling)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_username text; v_display_name text; v_suffix text;
BEGIN
  v_username := COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1));
  v_display_name := COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1));

  BEGIN
    INSERT INTO public.profiles (id, username, display_name) VALUES (NEW.id, v_username, v_display_name);
  EXCEPTION WHEN unique_violation THEN
    v_suffix := substr(NEW.id::text, 1, 4);
    INSERT INTO public.profiles (id, username, display_name) VALUES (NEW.id, v_username || '_' || v_suffix, v_display_name);
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic create_group function
CREATE OR REPLACE FUNCTION public.create_group(
  p_name text, p_description text, p_currency_name text,
  p_currency_symbol text, p_starting_balance integer
)
RETURNS uuid AS $$
DECLARE
  v_caller_uid uuid; v_group_id uuid; v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_i integer;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  PERFORM set_config('app.bypass_member_guard', 'true', true);

  INSERT INTO public.groups (name, description, currency_name, currency_symbol, starting_balance, created_by)
  VALUES (p_name, p_description,
    COALESCE(NULLIF(p_currency_name, ''), 'Coins'),
    COALESCE(NULLIF(p_currency_symbol, ''), '🪙'),
    COALESCE(p_starting_balance, 1000), v_caller_uid)
  RETURNING id INTO v_group_id;

  INSERT INTO public.group_members (group_id, user_id, balance, role)
  VALUES (v_group_id, v_caller_uid, COALESCE(p_starting_balance, 1000), 'admin');

  v_code := '';
  FOR v_i IN 1..8 LOOP
    v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::integer, 1);
  END LOOP;

  INSERT INTO public.invite_codes (group_id, code) VALUES (v_group_id, v_code);

  RETURN v_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- DONE! All tables, functions, triggers, RLS policies, and indexes are set up.
--
-- Next steps (in Supabase dashboard):
-- 1. Create storage bucket "bet-proofs" (private, 50MB max)
-- 2. Configure Auth URLs (site URL + redirect URLs)
-- 3. Enable Realtime on "bets" and "bet_wagers" tables
-- ============================================================================
