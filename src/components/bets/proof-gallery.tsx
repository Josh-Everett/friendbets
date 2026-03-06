'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useSupabase } from '@/hooks/use-supabase'
import { MAX_PROOF_SIZE, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES } from '@/lib/constants'

interface ProofGalleryProps {
  betId: string
  groupId: string
  proofs: any[]
  canUpload: boolean
}

export function ProofGallery({ betId, groupId, proofs, canUpload }: ProofGalleryProps) {
  const router = useRouter()
  const supabase = useSupabase()
  const { toast } = useToast()
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_PROOF_SIZE) {
      toast('File too large (max 50MB)', 'error')
      return
    }

    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type)
    if (!isImage && !isVideo) {
      toast('Unsupported file type', 'error')
      return
    }

    setUploading(true)

    try {
      // Step 1: Get signed upload URL from server (validates membership)
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          content_type: file.type,
          bet_id: betId,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast(data.error || 'Upload failed', 'error')
        setUploading(false)
        return
      }

      const { path } = await res.json()

      // Step 2: Upload file directly to storage using the path
      const { error: uploadError } = await supabase.storage
        .from('bet-proofs')
        .upload(path, file)

      if (uploadError) {
        toast('Upload failed', 'error')
        setUploading(false)
        return
      }

      // Step 3: Save proof metadata
      const { error: dbError } = await supabase.from('bet_proofs').insert({
        bet_id: betId,
        uploaded_by: (await supabase.auth.getUser()).data.user!.id,
        file_path: path,
        file_type: isImage ? 'image' : 'video',
      })

      if (dbError) {
        toast('Failed to save proof', 'error')
      } else {
        toast('Proof uploaded!', 'success')
        router.refresh()
      }
    } catch {
      toast('Upload failed', 'error')
    }
    setUploading(false)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Proof ({proofs.length})</h2>
          {canUpload && (
            <label className="cursor-pointer">
              <Button variant="secondary" size="sm" loading={uploading} onClick={() => {}}>
                <Camera size={16} />
                Upload
              </Button>
              <input
                type="file"
                accept="image/*,video/*"
                onChange={handleUpload}
                className="hidden"
              />
            </label>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {proofs.length === 0 ? (
          <p className="text-sm text-[#a2a8cc]">No proof uploaded yet</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {proofs.map((proof: any) => {
              const url = supabase.storage.from('bet-proofs').getPublicUrl(proof.file_path).data.publicUrl
              return (
                <div key={proof.id} className="relative rounded-lg overflow-hidden bg-[#1a2340] aspect-square">
                  {proof.file_type === 'image' ? (
                    <img src={url} alt="Proof" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <video src={url} controls className="max-w-full max-h-full" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
