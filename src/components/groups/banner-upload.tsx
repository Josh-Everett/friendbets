'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useSupabase } from '@/hooks/use-supabase'
import { useToast } from '@/components/ui/toast'
import { ALLOWED_IMAGE_TYPES, MAX_BANNER_SIZE } from '@/lib/constants'
import { ImagePlus, X } from 'lucide-react'

interface BannerUploadProps {
  groupId: string
  currentBannerUrl: string | null
}

export function BannerUpload({ groupId, currentBannerUrl }: BannerUploadProps) {
  const supabase = useSupabase()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [bannerUrl, setBannerUrl] = useState(currentBannerUrl)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast('Only JPEG, PNG, GIF, and WebP images are allowed', 'error')
      return
    }

    if (file.size > MAX_BANNER_SIZE) {
      toast('Banner image must be under 5MB', 'error')
      return
    }

    setUploading(true)

    try {
      // 1. Get signed upload URL
      const res = await fetch('/api/groups/banner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          file_name: file.name,
          content_type: file.type,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to get upload URL')
      }

      const { token, path } = await res.json()

      // 2. Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('group-banners')
        .uploadToSignedUrl(path, token, file)

      if (uploadError) throw uploadError

      // 3. Get public URL and update group
      const { data: { publicUrl } } = supabase.storage
        .from('group-banners')
        .getPublicUrl(path)

      const { error: updateError } = await supabase
        .from('groups')
        .update({ banner_url: publicUrl })
        .eq('id', groupId) as { error: any }

      if (updateError) throw updateError

      setBannerUrl(publicUrl)
      toast('Banner updated', 'success')
    } catch (err: any) {
      toast(err.message || 'Failed to upload banner', 'error')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemove = async () => {
    setUploading(true)
    try {
      const { error } = await supabase
        .from('groups')
        .update({ banner_url: null })
        .eq('id', groupId) as { error: any }

      if (error) throw error

      setBannerUrl(null)
      toast('Banner removed', 'success')
    } catch (err: any) {
      toast(err.message || 'Failed to remove banner', 'error')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      {bannerUrl ? (
        <div className="relative rounded-lg overflow-hidden">
          <img
            src={bannerUrl}
            alt="Group banner"
            className="w-full h-32 object-cover"
          />
          <button
            onClick={handleRemove}
            disabled={uploading}
            className="absolute top-2 right-2 p-1 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="w-full h-32 rounded-lg border border-dashed border-[rgba(255,255,255,0.1)] flex items-center justify-center text-[#a2a8cc]">
          <span className="text-sm">No banner set</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleFileSelect}
        className="hidden"
      />
      <Button
        variant="secondary"
        size="sm"
        loading={uploading}
        onClick={() => fileInputRef.current?.click()}
      >
        <ImagePlus className="w-4 h-4 mr-2" />
        {bannerUrl ? 'Change Banner' : 'Upload Banner'}
      </Button>
      <p className="text-xs text-[#a2a8cc]">
        JPEG, PNG, GIF, or WebP. Max 5MB. Shown on group invite links.
      </p>
    </div>
  )
}
