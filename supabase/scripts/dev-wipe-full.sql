-- ============================================================================
-- dev-wipe-full.sql
-- NUCLEAR OPTION: Deletes ALL data including auth users.
-- Everyone will need to re-signup after running this.
--
-- Usage: Paste into Supabase SQL Editor and run.
-- ============================================================================

-- 1. Delete all app data (leaf tables first, then parents)
--    TRUNCATE CASCADE handles FK dependencies automatically.
TRUNCATE
  public.achievements,
  public.bet_proofs,
  public.bet_votes,
  public.bet_wagers,
  public.bets,
  public.invite_codes,
  public.group_members,
  public.groups,
  public.profiles
CASCADE;

-- 2. Delete all auth users (cascades to profiles via FK, but we already truncated)
DELETE FROM auth.users;

-- 3. Clear storage objects metadata (actual files need manual bucket clear in dashboard)
DELETE FROM storage.objects WHERE bucket_id = 'bet-proofs';
