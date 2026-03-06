-- ============================================================================
-- 001_initial_schema.sql
-- Full database schema for FriendBets
-- ============================================================================

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- profiles (mirrors auth.users)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

-- groups
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

-- group_members
CREATE TABLE public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  balance integer NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- invite_codes
CREATE TABLE public.invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  code text UNIQUE NOT NULL,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- bets
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

-- bet_wagers
CREATE TABLE public.bet_wagers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id uuid REFERENCES public.bets(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) NOT NULL,
  side text NOT NULL CHECK (side IN ('for', 'against')),
  amount integer NOT NULL CHECK (amount > 0),
  payout integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(bet_id, user_id) -- one wager per user per bet
);

-- bet_votes
CREATE TABLE public.bet_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id uuid REFERENCES public.bets(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) NOT NULL,
  vote boolean NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(bet_id, user_id)
);

-- bet_proofs
CREATE TABLE public.bet_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id uuid REFERENCES public.bets(id) ON DELETE CASCADE NOT NULL,
  uploaded_by uuid REFERENCES public.profiles(id) NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('image', 'video')),
  caption text,
  created_at timestamptz DEFAULT now()
);

-- achievements
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
-- 2. TRIGGER: Auto-create profile on signup
-- ============================================================================

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
-- 3. DATABASE FUNCTIONS (SECURITY DEFINER)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- place_wager: atomically place a wager on a bet
-- ---------------------------------------------------------------------------
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
  -- Verify bet exists and is open
  SELECT group_id, status INTO v_group_id, v_bet_status
  FROM public.bets
  WHERE id = p_bet_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  IF v_bet_status <> 'open' THEN
    RAISE EXCEPTION 'Bet is not open for wagers (status: %)', v_bet_status;
  END IF;

  -- Verify user is a group member and get their balance
  SELECT balance INTO v_current_balance
  FROM public.group_members
  WHERE group_id = v_group_id AND user_id = p_user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  -- Verify user hasn't already wagered on this bet
  SELECT id INTO v_existing_wager
  FROM public.bet_wagers
  WHERE bet_id = p_bet_id AND user_id = p_user_id;

  IF v_existing_wager IS NOT NULL THEN
    RAISE EXCEPTION 'User has already placed a wager on this bet';
  END IF;

  -- Verify user has sufficient balance
  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %', v_current_balance, p_amount;
  END IF;

  -- Deduct balance from group_members
  UPDATE public.group_members
  SET balance = balance - p_amount
  WHERE group_id = v_group_id AND user_id = p_user_id;

  -- Insert into bet_wagers
  INSERT INTO public.bet_wagers (bet_id, user_id, side, amount)
  VALUES (p_bet_id, p_user_id, p_side, p_amount)
  RETURNING id INTO v_wager_id;

  RETURN v_wager_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- resolve_bet: resolve a bet and calculate payouts
-- ---------------------------------------------------------------------------
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
  -- Fetch the bet
  SELECT * INTO v_bet
  FROM public.bets
  WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
  END IF;

  -- Verify bet is open or locked
  IF v_bet.status NOT IN ('open', 'locked') THEN
    RAISE EXCEPTION 'Bet cannot be resolved (status: %)', v_bet.status;
  END IF;

  -- Determine winning and losing sides
  IF p_outcome = true THEN
    v_winner_side := 'for';
    v_loser_side := 'against';
  ELSE
    v_winner_side := 'against';
    v_loser_side := 'for';
  END IF;

  -- Calculate pools
  SELECT COALESCE(SUM(amount), 0) INTO v_winner_pool
  FROM public.bet_wagers
  WHERE bet_id = p_bet_id AND side = v_winner_side;

  SELECT COALESCE(SUM(amount), 0) INTO v_loser_pool
  FROM public.bet_wagers
  WHERE bet_id = p_bet_id AND side = v_loser_side;

  v_total_pool := v_winner_pool + v_loser_pool;

  -- Update bet status
  UPDATE public.bets
  SET status = 'resolved',
      outcome = p_outcome,
      resolved_at = now()
  WHERE id = p_bet_id;

  -- Calculate and distribute payouts
  IF v_winner_pool > 0 THEN
    -- Winners get their wager back + proportional share of loser pool
    FOR v_wager IN
      SELECT id, user_id, amount
      FROM public.bet_wagers
      WHERE bet_id = p_bet_id AND side = v_winner_side
    LOOP
      DECLARE
        v_payout integer;
      BEGIN
        -- wager back + (wager / winner_pool) * loser_pool
        v_payout := v_wager.amount + (v_wager.amount::bigint * v_loser_pool / v_winner_pool)::integer;

        -- Update wager payout
        UPDATE public.bet_wagers
        SET payout = v_payout
        WHERE id = v_wager.id;

        -- Credit winner balance
        UPDATE public.group_members
        SET balance = balance + v_payout
        WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id;
      END;
    END LOOP;
  END IF;

  -- Losers get payout = 0
  UPDATE public.bet_wagers
  SET payout = 0
  WHERE bet_id = p_bet_id AND side = v_loser_side;

  -- Subject bonus: if subject_user_id exists AND outcome is true AND subject != created_by
  -- Credit the subject with the FULL POT as a bonus
  IF v_bet.subject_user_id IS NOT NULL
     AND p_outcome = true
     AND v_bet.subject_user_id <> v_bet.created_by
  THEN
    UPDATE public.group_members
    SET balance = balance + v_total_pool::integer
    WHERE group_id = v_bet.group_id AND user_id = v_bet.subject_user_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- cancel_bet: cancel a bet and refund all wagers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_bet(
  p_bet_id uuid
)
RETURNS void AS $$
DECLARE
  v_bet RECORD;
  v_wager RECORD;
BEGIN
  -- Fetch the bet
  SELECT * INTO v_bet
  FROM public.bets
  WHERE id = p_bet_id;

  IF v_bet.id IS NULL THEN
    RAISE EXCEPTION 'Bet not found';
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
    WHERE group_id = v_bet.group_id AND user_id = v_wager.user_id;

    -- Update payout to equal amount (refund)
    UPDATE public.bet_wagers
    SET payout = v_wager.amount
    WHERE id = v_wager.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on ALL tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_wagers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bet_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- Anyone authenticated can read profiles
CREATE POLICY "Profiles are viewable by authenticated users"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- Users can update their own profile
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------

-- Members can see their groups
CREATE POLICY "Members can view their groups"
ON public.groups FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  )
);

-- Authenticated users can create groups
CREATE POLICY "Authenticated users can create groups"
ON public.groups FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

-- ---------------------------------------------------------------------------
-- group_members
-- ---------------------------------------------------------------------------

-- Members can see other members in their groups
CREATE POLICY "Members can see group members"
ON public.group_members FOR SELECT
TO authenticated
USING (
  group_id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  )
);

-- Group creator or admins can insert members (invite flow handled by API)
CREATE POLICY "Admins and creators can add members"
ON public.group_members FOR INSERT
TO authenticated
WITH CHECK (
  -- The user is an admin of this group
  EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = group_members.group_id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
  -- Or the user is adding themselves (via invite code, handled by API)
  OR user_id = auth.uid()
);

-- Admins can update roles
CREATE POLICY "Admins can update member roles"
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

-- Admins can remove members
CREATE POLICY "Admins can remove members"
ON public.group_members FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = group_members.group_id
      AND gm.user_id = auth.uid()
      AND gm.role = 'admin'
  )
);

-- ---------------------------------------------------------------------------
-- invite_codes
-- ---------------------------------------------------------------------------

-- Group members can see invite codes
CREATE POLICY "Group members can view invite codes"
ON public.invite_codes FOR SELECT
TO authenticated
USING (
  group_id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  )
);

-- Group admins can create invite codes
CREATE POLICY "Group admins can create invite codes"
ON public.invite_codes FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = invite_codes.group_id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
);

-- ---------------------------------------------------------------------------
-- bets
-- ---------------------------------------------------------------------------

-- Group members can see bets in their groups
CREATE POLICY "Group members can view bets"
ON public.bets FOR SELECT
TO authenticated
USING (
  group_id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  )
);

-- Group members can create bets
CREATE POLICY "Group members can create bets"
ON public.bets FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = bets.group_id
      AND user_id = auth.uid()
  )
  AND created_by = auth.uid()
);

-- Bet creator or group admin can update
CREATE POLICY "Bet creator or admin can update bets"
ON public.bets FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = bets.group_id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
)
WITH CHECK (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = bets.group_id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
);

-- ---------------------------------------------------------------------------
-- bet_wagers
-- ---------------------------------------------------------------------------

-- Group members can see wagers
CREATE POLICY "Group members can view wagers"
ON public.bet_wagers FOR SELECT
TO authenticated
USING (
  bet_id IN (
    SELECT b.id FROM public.bets b
    JOIN public.group_members gm ON gm.group_id = b.group_id
    WHERE gm.user_id = auth.uid()
  )
);

-- Wagers are inserted via the place_wager function (SECURITY DEFINER)
-- This policy allows the function to insert on behalf of users
CREATE POLICY "Wagers are placed via place_wager function"
ON public.bet_wagers FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- bet_votes
-- ---------------------------------------------------------------------------

-- Group members can see votes
CREATE POLICY "Group members can view votes"
ON public.bet_votes FOR SELECT
TO authenticated
USING (
  bet_id IN (
    SELECT b.id FROM public.bets b
    JOIN public.group_members gm ON gm.group_id = b.group_id
    WHERE gm.user_id = auth.uid()
  )
);

-- Group members can vote (one per user per bet enforced by UNIQUE constraint)
CREATE POLICY "Group members can vote"
ON public.bet_votes FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.bets b
    JOIN public.group_members gm ON gm.group_id = b.group_id
    WHERE b.id = bet_votes.bet_id
      AND gm.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- bet_proofs
-- ---------------------------------------------------------------------------

-- Group members can see proofs
CREATE POLICY "Group members can view proofs"
ON public.bet_proofs FOR SELECT
TO authenticated
USING (
  bet_id IN (
    SELECT b.id FROM public.bets b
    JOIN public.group_members gm ON gm.group_id = b.group_id
    WHERE gm.user_id = auth.uid()
  )
);

-- Group members can upload proofs
CREATE POLICY "Group members can upload proofs"
ON public.bet_proofs FOR INSERT
TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.bets b
    JOIN public.group_members gm ON gm.group_id = b.group_id
    WHERE b.id = bet_proofs.bet_id
      AND gm.user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- achievements
-- ---------------------------------------------------------------------------

-- Group members can see achievements
CREATE POLICY "Group members can view achievements"
ON public.achievements FOR SELECT
TO authenticated
USING (
  group_id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  )
);


-- ============================================================================
-- 5. INDEXES
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
-- 6. STORAGE
-- ============================================================================

-- Storage bucket for bet proofs (run in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('bet-proofs', 'bet-proofs', false);

-- NOTE: The "bet-proofs" storage bucket must be created via the Supabase dashboard
-- or the Supabase CLI. Configure the bucket with:
--   - Max file size: 50MB (52428800 bytes)
--   - Allowed MIME types: image/jpeg, image/png, image/gif, image/webp,
--     video/mp4, video/quicktime, video/webm
-- Storage policies are defined in 002_storage.sql.
