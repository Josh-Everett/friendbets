'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, ChevronDown, Users, Plus } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { useSupabase } from '@/hooks/use-supabase'
import type { Profile } from '@/lib/types/app'

interface AppNavProps {
  user: { id: string; email: string }
  profile: Profile | null
  groups: { id: string; name: string; currency_symbol: string }[]
}

export function AppNav({ user, profile, groups }: AppNavProps) {
  const router = useRouter()
  const supabase = useSupabase()
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-30 bg-[#151d30]/80 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <a href="/dashboard" className="text-xl font-bold text-white">
            FriendBets
          </a>

          {/* Group Switcher */}
          {groups.length > 0 && (
            <div className="relative hidden sm:block">
              <button
                onClick={() => { setGroupMenuOpen(!groupMenuOpen); setUserMenuOpen(false) }}
                className="flex items-center gap-2 text-sm text-[#a2a8cc] hover:text-white transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
              >
                <Users size={16} />
                <span>Groups</span>
                <ChevronDown size={14} />
              </button>
              {groupMenuOpen && (
                <div className="absolute top-full mt-1 left-0 w-56 bg-[#1a2340] border border-white/10 rounded-lg shadow-xl py-1 z-50">
                  {groups.map((g) => (
                    <a
                      key={g.id}
                      href={`/groups/${g.id}`}
                      className="block px-4 py-2 text-sm text-[#a2a8cc] hover:text-white hover:bg-white/5"
                      onClick={() => setGroupMenuOpen(false)}
                    >
                      {g.currency_symbol} {g.name}
                    </a>
                  ))}
                  <hr className="border-white/5 my-1" />
                  <a
                    href="/dashboard"
                    className="flex items-center gap-2 px-4 py-2 text-sm text-[#ba0963] hover:bg-white/5"
                    onClick={() => setGroupMenuOpen(false)}
                  >
                    <Plus size={14} />
                    Create Group
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => { setUserMenuOpen(!userMenuOpen); setGroupMenuOpen(false) }}
            className="flex items-center gap-2 hover:bg-white/5 rounded-lg px-2 py-1 transition-colors"
          >
            <Avatar name={profile?.display_name || profile?.username || 'U'} size="sm" />
            <span className="text-sm text-[#a2a8cc] hidden sm:inline">
              {profile?.display_name || profile?.username}
            </span>
            <ChevronDown size={14} className="text-[#a2a8cc]" />
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-[#1a2340] border border-white/10 rounded-lg shadow-xl py-1 z-50">
              <a
                href="/profile"
                className="block px-4 py-2 text-sm text-[#a2a8cc] hover:text-white hover:bg-white/5"
                onClick={() => setUserMenuOpen(false)}
              >
                Profile
              </a>
              <hr className="border-white/5 my-1" />
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-white/5 text-left"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
