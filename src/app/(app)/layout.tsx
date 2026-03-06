import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppNav } from '@/components/layout/app-nav'
import { ToastProvider } from '@/components/ui/toast'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Get user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single() as { data: any }

  // Get user's groups for the group switcher
  const { data: memberships } = await supabase
    .from('group_members')
    .select('group_id, groups(id, name, currency_symbol)')
    .eq('user_id', user.id) as { data: any[] | null }

  const groups = memberships?.map((m: any) => m.groups).filter(Boolean) ?? []

  // Credit daily allowance for each group (fire-and-forget, checked internally for 24h)
  if (memberships && memberships.length > 0) {
    for (const member of memberships) {
      try {
        await (supabase.rpc as any)('credit_daily_allowance', {
          p_group_id: (member as any).group_id,
          p_user_id: user.id,
        })
      } catch {
        // Daily allowance credit failed — not critical, continue
      }
    }
  }

  return (
    <ToastProvider>
      <div className="min-h-screen flex flex-col">
        <AppNav
          user={{ id: user.id, email: user.email ?? '' }}
          profile={profile}
          groups={groups}
        />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
        {/* Mobile bottom nav */}
        <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-[#151d30] border-t border-white/5 px-4 py-2 flex justify-around z-40">
          <a href="/dashboard" className="flex flex-col items-center gap-1 text-[#a2a8cc] hover:text-white py-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span className="text-xs">Home</span>
          </a>
          <a href="/profile" className="flex flex-col items-center gap-1 text-[#a2a8cc] hover:text-white py-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span className="text-xs">Profile</span>
          </a>
        </nav>
      </div>
    </ToastProvider>
  )
}
