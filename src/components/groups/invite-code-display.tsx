'use client'

import { useState, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSupabase } from '@/hooks/use-supabase'

interface InviteCodeDisplayProps {
  groupId: string
}

export function InviteCodeDisplay({ groupId }: InviteCodeDisplayProps) {
  const supabase = useSupabase()
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchCode = async () => {
      const { data } = await supabase
        .from('invite_codes')
        .select('code')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      setCode(data?.code ?? null)
      setLoading(false)
    }
    fetchCode()
  }, [supabase, groupId])

  const shareLink = code ? `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${code}` : ''

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <div className="text-[#a2a8cc] text-sm">Loading invite code...</div>
  if (!code) return <div className="text-[#a2a8cc] text-sm">No invite code available</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-[#1a2340] border border-white/10 rounded-lg px-4 py-2.5 font-mono text-lg text-white tracking-wider text-center">
          {code}
        </div>
        <Button variant="secondary" size="sm" onClick={handleCopy}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </Button>
      </div>
      <p className="text-xs text-[#a2a8cc] break-all">
        Share link: <span className="text-white">{shareLink}</span>
      </p>
    </div>
  )
}
