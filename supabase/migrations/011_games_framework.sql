-- Games Framework
-- Generic tables for all mini-games with pool-accumulator betting

-- ============================================================
-- 1. game_pools — one per game per group
-- ============================================================
CREATE TABLE public.game_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  game_type text NOT NULL,
  balance integer NOT NULL DEFAULT 0,
  daily_high_score integer,
  daily_high_user_id uuid REFERENCES public.profiles(id),
  daily_reset_at timestamptz NOT NULL DEFAULT (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '1 day'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, game_type)
);

-- ============================================================
-- 2. game_plays — every play of every game
-- ============================================================
CREATE TABLE public.game_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  game_type text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  bet_amount integer NOT NULL DEFAULT 0,
  payout integer NOT NULL DEFAULT 0,
  is_winner boolean NOT NULL DEFAULT false,
  result jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. RLS
-- ============================================================
ALTER TABLE public.game_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_plays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Group members can view game pools"
  ON public.game_pools FOR SELECT
  USING (group_id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Group members can view game plays"
  ON public.game_plays FOR SELECT
  USING (group_id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  ));

-- ============================================================
-- 4. Indexes
-- ============================================================
CREATE INDEX idx_game_pools_group ON public.game_pools(group_id);
CREATE INDEX idx_game_plays_group_type ON public.game_plays(group_id, game_type);
CREATE INDEX idx_game_plays_daily ON public.game_plays(group_id, game_type, created_at DESC);
CREATE INDEX idx_game_plays_score ON public.game_plays(game_type, group_id, score DESC);

-- ============================================================
-- 5. Extend transactions type constraint for game types
-- ============================================================
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_check;

ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN (
    'wager_placed', 'bet_payout', 'bet_refund',
    'daily_allowance', 'season_reset', 'subject_bonus',
    'game_entry', 'game_payout'
  ));

-- ============================================================
-- 6. submit_game_score RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_game_score(
  p_group_id uuid,
  p_user_id uuid,
  p_game_type text,
  p_score integer,
  p_bet_amount integer DEFAULT 0,
  p_result jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_membership record;
  v_pool record;
  v_pool_balance integer;
  v_play_id uuid;
  v_won boolean := false;
  v_payout integer := 0;
  v_new_balance integer;
  v_today_start timestamptz;
BEGIN
  v_today_start := date_trunc('day', now() AT TIME ZONE 'UTC');

  -- Verify membership and get balance
  SELECT * INTO v_membership
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  -- Validate inputs
  IF p_bet_amount < 0 THEN
    RAISE EXCEPTION 'Bet amount cannot be negative';
  END IF;

  IF p_bet_amount > 0 AND v_membership.balance < p_bet_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  IF p_score < 0 OR p_score > 9999 THEN
    RAISE EXCEPTION 'Invalid score';
  END IF;

  -- Get or create pool (auto-creates on first play)
  INSERT INTO public.game_pools (group_id, game_type, balance, daily_reset_at)
  VALUES (p_group_id, p_game_type, 0, v_today_start + interval '1 day')
  ON CONFLICT (group_id, game_type) DO NOTHING;

  SELECT * INTO v_pool
  FROM public.game_pools
  WHERE group_id = p_group_id AND game_type = p_game_type
  FOR UPDATE;

  -- Check for daily reset
  IF now() >= v_pool.daily_reset_at THEN
    UPDATE public.game_pools
    SET daily_high_score = NULL,
        daily_high_user_id = NULL,
        daily_reset_at = v_today_start + interval '1 day'
    WHERE id = v_pool.id;
    v_pool.daily_high_score := NULL;
    v_pool.daily_high_user_id := NULL;
  END IF;

  v_pool_balance := v_pool.balance;

  -- Deduct bet and add to pool
  IF p_bet_amount > 0 THEN
    UPDATE public.group_members
    SET balance = balance - p_bet_amount
    WHERE group_id = p_group_id AND user_id = p_user_id;

    UPDATE public.game_pools
    SET balance = balance + p_bet_amount
    WHERE id = v_pool.id;

    v_pool_balance := v_pool_balance + p_bet_amount;
  END IF;

  -- Win condition: beat existing daily high score with a bet
  IF p_bet_amount > 0
    AND v_pool.daily_high_score IS NOT NULL
    AND p_score > v_pool.daily_high_score
  THEN
    v_won := true;
    v_payout := v_pool_balance;

    -- Credit entire pool to winner
    UPDATE public.group_members
    SET balance = balance + v_payout
    WHERE group_id = p_group_id AND user_id = p_user_id;

    -- Reset pool
    UPDATE public.game_pools
    SET balance = 0
    WHERE id = v_pool.id;

    v_pool_balance := 0;
  END IF;

  -- Update daily high score if beaten (free plays count too)
  IF v_pool.daily_high_score IS NULL OR p_score > v_pool.daily_high_score THEN
    UPDATE public.game_pools
    SET daily_high_score = p_score,
        daily_high_user_id = p_user_id
    WHERE id = v_pool.id;
  END IF;

  -- Record the play
  INSERT INTO public.game_plays (group_id, user_id, game_type, score, bet_amount, payout, is_winner, result)
  VALUES (p_group_id, p_user_id, p_game_type, p_score, p_bet_amount, v_payout, v_won, p_result)
  RETURNING id INTO v_play_id;

  -- Get updated balance
  SELECT balance INTO v_new_balance
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  -- Record transactions
  IF p_bet_amount > 0 THEN
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (p_group_id, p_user_id, 'game_entry', -p_bet_amount, v_new_balance, 'game_play', v_play_id, p_game_type || ' entry');
  END IF;

  IF v_won THEN
    INSERT INTO public.transactions (group_id, user_id, type, amount, balance_after, reference_type, reference_id, description)
    VALUES (p_group_id, p_user_id, 'game_payout', v_payout, v_new_balance, 'game_play', v_play_id, p_game_type || ' pool win');
  END IF;

  RETURN jsonb_build_object(
    'play_id', v_play_id,
    'won_pool', v_won,
    'payout', v_payout,
    'new_daily_high', GREATEST(COALESCE(v_pool.daily_high_score, 0), p_score),
    'new_pool', v_pool_balance,
    'new_balance', v_new_balance
  );
END;
$$;
