-- ============================================================================
-- dev-wipe-keep-users.sql
-- Deletes all group/bet data but keeps auth users and profiles intact.
-- No one needs to re-signup. Just re-create groups and start fresh.
--
-- Usage: Paste into Supabase SQL Editor and run.
-- ============================================================================

-- Deleting groups cascades to:
--   group_members (ON DELETE CASCADE)
--   invite_codes  (ON DELETE CASCADE)
--   bets          (ON DELETE CASCADE)
--     -> bet_wagers  (ON DELETE CASCADE)
--     -> bet_votes   (ON DELETE CASCADE)
--     -> bet_proofs  (ON DELETE CASCADE)
--   achievements  (ON DELETE CASCADE)
--
-- So one delete handles everything.
DELETE FROM public.groups;

-- Clear storage objects metadata (actual files need manual bucket clear in dashboard)
DELETE FROM storage.objects WHERE bucket_id = 'bet-proofs';
