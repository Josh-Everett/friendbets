-- ============================================================================
-- 010_group_banners.sql
-- Add group banner support: column, storage bucket, and policies
-- ============================================================================

-- Add banner_url column to groups
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS banner_url text;

-- Create public storage bucket for group banners
-- Public = true so invite pages can display banners without auth
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('group-banners', 'group-banners', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'])  -- 5MB limit, images only
ON CONFLICT (id) DO UPDATE SET allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Upload: authenticated users can upload to paths starting with their user ID
-- Path format: {group_id}/{user_id}/{timestamp}.{ext}
-- Admin check happens at the API layer; storage policy scopes to user's own subfolder
CREATE POLICY "Authenticated users can upload group banners"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'group-banners'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Public read: anyone can view banners (needed for invite pages)
CREATE POLICY "Anyone can view group banners"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'group-banners');

-- Delete: users can delete their own uploads (for replacing banners)
CREATE POLICY "Users can delete own banner uploads"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'group-banners'
  AND (storage.foldername(name))[2] = auth.uid()::text
);
