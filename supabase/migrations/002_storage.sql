-- ============================================================================
-- 002_storage.sql
-- Storage policies for the bet-proofs bucket
-- ============================================================================

-- Storage policies for bet-proofs bucket
-- Run after creating the bucket in the Supabase dashboard

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'bet-proofs');

-- Allow authenticated users to view proofs
CREATE POLICY "Users can view proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'bet-proofs');
