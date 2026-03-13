-- Add short_id column to bets for shorter URLs
ALTER TABLE bets ADD COLUMN short_id text;

-- Populate existing bets with first 4 chars of their UUID
UPDATE bets SET short_id = substr(id::text, 1, 4);

-- Handle any collisions within the same group by extending to 8 chars
UPDATE bets b1
SET short_id = substr(b1.id::text, 1, 8)
WHERE EXISTS (
  SELECT 1 FROM bets b2
  WHERE b2.group_id = b1.group_id
    AND b2.short_id = b1.short_id
    AND b2.id != b1.id
);

ALTER TABLE bets ALTER COLUMN short_id SET NOT NULL;
ALTER TABLE bets ADD CONSTRAINT bets_group_short_id_unique UNIQUE (group_id, short_id);

-- Update create_market to generate short_id
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
  v_short_id text;
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
    yes_pool, no_pool, k, creator_side, creator_wager_amount,
    short_id
  ) VALUES (
    p_group_id, p_created_by, p_title, p_description, p_subject_user_id,
    p_resolution_method, p_deadline, p_virtual_liquidity,
    p_virtual_liquidity, p_virtual_liquidity, v_k,
    p_creator_side, p_creator_amount,
    'temp'
  ) RETURNING id INTO v_bet_id;

  -- Generate short_id from the new UUID
  v_short_id := substr(v_bet_id::text, 1, 4);

  -- Check for collision within group, extend if needed
  IF EXISTS (
    SELECT 1 FROM public.bets
    WHERE group_id = p_group_id AND short_id = v_short_id AND id != v_bet_id
  ) THEN
    v_short_id := substr(v_bet_id::text, 1, 8);
  END IF;

  UPDATE public.bets SET short_id = v_short_id WHERE id = v_bet_id;

  -- Place creator's initial wager
  PERFORM public.buy_shares(v_bet_id, p_created_by, p_creator_side, p_creator_amount);

  RETURN v_bet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
