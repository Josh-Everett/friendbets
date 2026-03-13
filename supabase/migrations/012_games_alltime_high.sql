-- Add all-time high score tracking to game_pools

ALTER TABLE public.game_pools ADD COLUMN IF NOT EXISTS all_time_high_score integer;
ALTER TABLE public.game_pools ADD COLUMN IF NOT EXISTS all_time_high_user_id uuid REFERENCES public.profiles(id);

-- Replace submit_game_score with version that tracks all-time high
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

  SELECT * INTO v_membership
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this group';
  END IF;

  IF p_bet_amount < 0 THEN
    RAISE EXCEPTION 'Bet amount cannot be negative';
  END IF;

  IF p_bet_amount > 0 AND v_membership.balance < p_bet_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  IF p_score < 0 OR p_score > 9999 THEN
    RAISE EXCEPTION 'Invalid score';
  END IF;

  INSERT INTO public.game_pools (group_id, game_type, balance, daily_reset_at)
  VALUES (p_group_id, p_game_type, 0, v_today_start + interval '1 day')
  ON CONFLICT (group_id, game_type) DO NOTHING;

  SELECT * INTO v_pool
  FROM public.game_pools
  WHERE group_id = p_group_id AND game_type = p_game_type
  FOR UPDATE;

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

  IF p_bet_amount > 0 THEN
    UPDATE public.group_members
    SET balance = balance - p_bet_amount
    WHERE group_id = p_group_id AND user_id = p_user_id;

    UPDATE public.game_pools
    SET balance = balance + p_bet_amount
    WHERE id = v_pool.id;

    v_pool_balance := v_pool_balance + p_bet_amount;
  END IF;

  IF p_bet_amount > 0
    AND v_pool.daily_high_score IS NOT NULL
    AND p_score > v_pool.daily_high_score
  THEN
    v_won := true;
    v_payout := v_pool_balance;

    UPDATE public.group_members
    SET balance = balance + v_payout
    WHERE group_id = p_group_id AND user_id = p_user_id;

    UPDATE public.game_pools
    SET balance = 0
    WHERE id = v_pool.id;

    v_pool_balance := 0;
  END IF;

  IF v_pool.daily_high_score IS NULL OR p_score > v_pool.daily_high_score THEN
    UPDATE public.game_pools
    SET daily_high_score = p_score,
        daily_high_user_id = p_user_id
    WHERE id = v_pool.id;
  END IF;

  IF v_pool.all_time_high_score IS NULL OR p_score > v_pool.all_time_high_score THEN
    UPDATE public.game_pools
    SET all_time_high_score = p_score,
        all_time_high_user_id = p_user_id
    WHERE id = v_pool.id;
  END IF;

  INSERT INTO public.game_plays (group_id, user_id, game_type, score, bet_amount, payout, is_winner, result)
  VALUES (p_group_id, p_user_id, p_game_type, p_score, p_bet_amount, v_payout, v_won, p_result)
  RETURNING id INTO v_play_id;

  SELECT balance INTO v_new_balance
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_user_id;

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
    'new_all_time_high', GREATEST(COALESCE(v_pool.all_time_high_score, 0), p_score),
    'new_pool', v_pool_balance,
    'new_balance', v_new_balance
  );
END;
$$;
