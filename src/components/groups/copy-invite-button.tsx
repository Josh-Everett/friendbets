'use client'

import { useState, useEffect } from 'react'
import { Link2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSupabase } from '@/hooks/use-supabase'

interface CopyInviteButtonProps {
  groupId: string
}

export function CopyInviteButton({ groupId }: CopyInviteButtonProps) {
  const supabase = useSupabase()
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
    }
    fetchCode()
  }, [supabase, groupId])

  if (!code) return null

  const handleCopy = async () => {
    const link = `${window.location.origin}/join/${code}`
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleCopy}>
      {copied ? <Check size={16} className="mr-1.5" /> : <Link2 size={16} className="mr-1.5" />}
      {copied ? 'Copied!' : 'Invite'}
    </Button>
  )
}
