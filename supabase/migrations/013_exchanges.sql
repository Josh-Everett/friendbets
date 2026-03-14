-- ============================================================================
-- 013_exchanges.sql
-- Exchange feature: post tasks/chores/favors with currency rewards
-- ============================================================================

-- ============================================================================
-- 1. TABLE
-- ============================================================================

CREATE TABLE public.exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  created_by uuid REFERENCES public.profiles(id) NOT NULL,
  title text NOT NULL,
  description text,
  reward integer NOT NULL CHECK (reward > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'completed', 'cancelled')),
  claimed_by uuid REFERENCES public.profiles(id),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_exchanges_group_id ON public.exchanges(group_id);
CREATE INDEX idx_exchanges_group_status ON public.exchanges(group_id, status);


-- ============================================================================
-- 2. SECURITY DEFINER FUNCTIONS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- create_exchange: validate membership + balance, escrow reward, insert row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_exchange(
  p_group_id uuid,
  p_created_by uuid,
  p_title text,
  p_description text,
  p_reward integer
)
RETURNS uuid AS $$
DECLARE
  v_current_balance integer;
  v_exchange_id uuid;
BEGIN
  PERFORM set_config('app.bypass_member_guard', 'true', true);

  -- Verify user is a group member and get their balance
  SELECT balance INTO v_current_balance
  FROM public.group_members
  WHERE group_id = p_group_id AND user_id = p_created_by;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User is not a member of this group';
  END IF;

  -- Verify sufficient balance for escrow
  IF v_current_balance < p_reward THEN
    RAISE EXCEPTION 'Insufficient balance. Current: %, Required: %', v_current_balance, p_reward;
  END IF;

  -- Deduct reward from poster's balance (escrow)
  UPDATE public.group_members
  SET balance = balance - p_reward
  WHERE group_id = p_group_id AND user_id = p_created_by;

  -- Insert exchange
  INSERT INTO public.exchanges (group_id, created_by, title, description, reward)
  VALUES (p_group_id, p_created_by, p_title, p_description, p_reward)
  RETURNING id INTO v_exchange_id;

  RETURN v_exchange_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- complete_exchange: validate poster is caller + status=claimed, credit claimer
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_exchange(
  p_exchange_id uuid,
  p_completed_by uuid
)
RETURNS void AS $$
DECLARE
  v_exchange RECORD;
BEGIN
  PERFORM set_config('app.bypass_member_guard', 'true', true);

  -- Fetch the exchange
  SELECT * INTO v_exchange
  FROM public.exchanges
  WHERE id = p_exchange_id;

  IF v_exchange.id IS NULL THEN
    RAISE EXCEPTION 'Exchange not found';
  END IF;

  IF v_exchange.status <> 'claimed' THEN
    RAISE EXCEPTION 'Exchange is not in claimed status (status: %)', v_exchange.status;
  END IF;

  -- Only the poster can mark as complete
  IF v_exchange.created_by <> p_completed_by THEN
    RAISE EXCEPTION 'Only the poster can mark an exchange as complete';
  END IF;

  -- Credit the claimer with the reward
  UPDATE public.group_members
  SET balance = balance + v_exchange.reward
  WHERE group_id = v_exchange.group_id AND user_id = v_exchange.claimed_by;

  -- Update exchange status
  UPDATE public.exchanges
  SET status = 'completed', completed_at = now()
  WHERE id = p_exchange_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------------
-- cancel_exchange: validate poster or admin, refund poster
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_exchange(
  p_exchange_id uuid,
  p_cancelled_by uuid
)
RETURNS void AS $$
DECLARE
  v_exchange RECORD;
  v_role text;
BEGIN
  PERFORM set_config('app.bypass_member_guard', 'true', true);

  -- Fetch the exchange
  SELECT * INTO v_exchange
  FROM public.exchanges
  WHERE id = p_exchange_id;

  IF v_exchange.id IS NULL THEN
    RAISE EXCEPTION 'Exchange not found';
  END IF;

  IF v_exchange.status NOT IN ('open', 'claimed') THEN
    RAISE EXCEPTION 'Exchange cannot be cancelled (status: %)', v_exchange.status;
  END IF;

  -- Check authorization: poster or admin
  IF v_exchange.created_by <> p_cancelled_by THEN
    SELECT role INTO v_role
    FROM public.group_members
    WHERE group_id = v_exchange.group_id AND user_id = p_cancelled_by;

    IF v_role IS NULL OR v_role <> 'admin' THEN
      RAISE EXCEPTION 'Only the poster or a group admin can cancel an exchange';
    END IF;
  END IF;

  -- Refund the poster
  UPDATE public.group_members
  SET balance = balance + v_exchange.reward
  WHERE group_id = v_exchange.group_id AND user_id = v_exchange.created_by;

  -- Update exchange status
  UPDATE public.exchanges
  SET status = 'cancelled'
  WHERE id = p_exchange_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.exchanges ENABLE ROW LEVEL SECURITY;

-- Group members can view exchanges
CREATE POLICY "Group members can view exchanges"
ON public.exchanges FOR SELECT
TO authenticated
USING (
  group_id IN (
    SELECT group_id FROM public.group_members WHERE user_id = auth.uid()
  )
);

-- Group members can create exchanges (via RPC, but policy needed for SECURITY DEFINER insert)
CREATE POLICY "Group members can create exchanges"
ON public.exchanges FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = exchanges.group_id
      AND user_id = auth.uid()
  )
  AND created_by = auth.uid()
);

-- Creator, claimer, or admin can update exchanges
CREATE POLICY "Exchange participants can update exchanges"
ON public.exchanges FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  OR claimed_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = exchanges.group_id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
)
WITH CHECK (
  created_by = auth.uid()
  OR claimed_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = exchanges.group_id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
);
