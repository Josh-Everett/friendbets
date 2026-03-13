import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Users } from 'lucide-react'
import Link from 'next/link'
import { CreateGroupForm } from '@/components/groups/create-group-form'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('group_members')
    .select('*, groups(*)')
    .eq('user_id', user!.id) as { data: any[] | null }

  const groups = memberships?.map((m: any) => ({
    ...m.groups,
    balance: m.balance,
    role: m.role,
  })) ?? []

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users size={48} className="mx-auto text-[#a2a8cc] mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">No groups yet</h2>
            <p className="text-[#a2a8cc] mb-6">Create a group or join one with an invite link</p>
            <CreateGroupForm />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group: any) => (
              <Link key={group.id} href={`/groups/${group.slug}`}>
                <Card className="hover:border-white/10 transition-colors cursor-pointer h-full">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-lg font-semibold text-white">{group.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-[#a2a8cc]">
                        {group.role}
                      </span>
                    </div>
                    {group.description && (
                      <p className="text-sm text-[#a2a8cc] mb-4 line-clamp-2">{group.description}</p>
                    )}
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                      <span className="text-sm text-[#a2a8cc]">Balance</span>
                      <span className="text-lg font-bold text-[#fdd160]">
                        {group.currency_symbol}{group.balance.toLocaleString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <Card>
            <CardContent className="py-6">
              <h2 className="text-lg font-semibold text-white mb-4">Create New Group</h2>
              <CreateGroupForm />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
