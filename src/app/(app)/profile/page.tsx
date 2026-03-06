import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user!.id)
    .single() as { data: any }

  const { data: memberships } = await supabase
    .from('group_members')
    .select('*, groups(name, currency_symbol)')
    .eq('user_id', user!.id) as { data: any[] | null }

  // Get bet stats
  const { data: wagers } = await supabase
    .from('bet_wagers')
    .select('*, bets!inner(status, outcome, group_id)')
    .eq('user_id', user!.id) as { data: any[] | null }

  const totalBets = wagers?.length ?? 0
  const resolvedWagers = wagers?.filter((w: any) => w.bets.status === 'resolved') ?? []
  const wins = resolvedWagers.filter((w: any) => (w.payout ?? 0) > w.amount).length
  const losses = resolvedWagers.filter((w: any) => (w.payout ?? 0) < w.amount).length

  // Get achievements
  const { data: achievements } = await supabase
    .from('achievements')
    .select('*')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false }) as { data: any[] | null }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Avatar
              name={profile?.display_name || profile?.username || 'User'}
              src={profile?.avatar_url}
              size="lg"
            />
            <div>
              <h1 className="text-2xl font-bold text-white">
                {profile?.display_name || profile?.username}
              </h1>
              <p className="text-[#a2a8cc]">@{profile?.username}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-white">{totalBets}</p>
            <p className="text-xs text-[#a2a8cc]">Total Bets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-green-400">{wins}</p>
            <p className="text-xs text-[#a2a8cc]">Wins</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-bold text-red-400">{losses}</p>
            <p className="text-xs text-[#a2a8cc]">Losses</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-white">Groups</h2>
        </CardHeader>
        <CardContent>
          {memberships && memberships.length > 0 ? (
            <div className="space-y-3">
              {memberships.map((m: any) => (
                <a
                  key={m.id}
                  href={`/groups/${m.group_id}`}
                  className="flex items-center justify-between py-2 hover:bg-white/5 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <span className="text-white">{m.groups.name}</span>
                  <span className="text-[#fdd160] font-semibold">
                    {m.groups.currency_symbol}{m.balance.toLocaleString()}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-[#a2a8cc]">Not in any groups yet</p>
          )}
        </CardContent>
      </Card>

      {achievements && achievements.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-white">Achievements</h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {achievements.map((a: any) => (
                <div key={a.id} className="flex items-center gap-3 bg-[#1a2340] rounded-lg p-3">
                  <Badge variant="gold">{a.type}</Badge>
                  <div>
                    <p className="text-sm font-medium text-white">{a.title}</p>
                    {a.description && <p className="text-xs text-[#a2a8cc]">{a.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
