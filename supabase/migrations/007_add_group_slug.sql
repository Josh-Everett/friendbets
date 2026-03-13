-- Add slug column to groups for readable URLs
ALTER TABLE groups ADD COLUMN slug text;

-- Generate slugs for existing groups from their names
UPDATE groups SET slug = lower(regexp_replace(
  regexp_replace(name, '[^a-zA-Z0-9\s-]', '', 'g'),
  '\s+', '-', 'g'
)) || '-' || substr(id::text, 1, 8);

-- Make slug NOT NULL and UNIQUE after populating
ALTER TABLE groups ALTER COLUMN slug SET NOT NULL;
ALTER TABLE groups ADD CONSTRAINT groups_slug_unique UNIQUE (slug);

-- Index for slug lookups
CREATE INDEX idx_groups_slug ON groups (slug);

-- Update create_group function to accept slug parameter
CREATE OR REPLACE FUNCTION create_group(
  p_name text,
  p_description text DEFAULT NULL,
  p_currency_name text DEFAULT NULL,
  p_currency_symbol text DEFAULT NULL,
  p_starting_balance integer DEFAULT 1000,
  p_slug text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_group_id uuid;
  v_code text;
  v_slug text;
BEGIN
  -- Generate slug if not provided
  v_slug := COALESCE(p_slug, lower(regexp_replace(
    regexp_replace(p_name, '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g'
  )));

  -- Ensure slug uniqueness by appending random suffix if needed
  IF EXISTS (SELECT 1 FROM groups WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 6);
  END IF;

  -- Create group
  INSERT INTO groups (name, description, currency_name, currency_symbol, starting_balance, created_by, slug)
  VALUES (
    p_name,
    p_description,
    COALESCE(p_currency_name, 'Coins'),
    COALESCE(p_currency_symbol, '🪙'),
    p_starting_balance,
    auth.uid(),
    v_slug
  )
  RETURNING id INTO v_group_id;

  -- Add creator as admin member
  INSERT INTO group_members (group_id, user_id, balance, role)
  VALUES (v_group_id, auth.uid(), p_starting_balance, 'admin');

  -- Generate invite code
  v_code := upper(substr(md5(random()::text), 1, 8));
  INSERT INTO invite_codes (group_id, code)
  VALUES (v_group_id, v_code);

  RETURN v_group_id;
END;
$$;
