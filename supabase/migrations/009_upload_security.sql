-- ============================================================================
-- 009_upload_security.sql
-- Add index on bet_proofs(bet_id) for query performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bet_proofs_bet_id ON public.bet_proofs(bet_id);
