'use client'

import { useEffect, useState } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ACHIEVEMENT_TYPES } from '@/lib/constants'
import { formatDistanceToNow } from 'date-fns'
import { Trophy } from 'lucide-react'

interface AchievementsListProps {
  groupId: string
}

export function AchievementsList({ groupId }: AchievementsListProps) {
  const supabase = useSupabase()
  const [achievements, setAchievements] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('achievements')
        .select('*, profiles(*)')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
      setAchievements(data ?? [])
      setLoading(false)
    }
    fetch()
  }, [supabase, groupId])

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-[#a2a8cc]">Loading achievements...</p>
        </CardContent>
      </Card>
    )
  }

  if (achievements.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Trophy size={48} className="mx-auto text-[#a2a8cc] mb-4" />
          <p className="text-[#a2a8cc]">No achievements yet. Start betting!</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {achievements.map((a: any) => {
        const achievementInfo = ACHIEVEMENT_TYPES[a.type as keyof typeof ACHIEVEMENT_TYPES]
        return (
          <Card key={a.id}>
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <div className="text-3xl">
                  {achievementInfo?.icon ?? '🏅'}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-[#fdd160]">{a.title}</h3>
                    <Badge variant="gold">{a.type}</Badge>
                  </div>
                  {a.description && (
                    <p className="text-sm text-[#a2a8cc]">{a.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <Avatar
                      name={a.profiles?.display_name || a.profiles?.username || 'User'}
                      size="sm"
                    />
                    <span className="text-xs text-[#a2a8cc]">
                      {a.profiles?.display_name || a.profiles?.username} • {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
