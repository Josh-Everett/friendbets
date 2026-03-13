'use client'

import { cn } from '@/lib/utils'
import Link from 'next/link'

interface GroupTabsProps {
  groupSlug: string
  activeTab: string
  isAdmin: boolean
}

const tabs = [
  { id: 'bets', label: 'Bets' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'history', label: 'History' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'settings', label: 'Settings', adminOnly: true },
]

export function GroupTabs({ groupSlug, activeTab, isAdmin }: GroupTabsProps) {
  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin)

  return (
    <div className="flex gap-1 border-b border-white/5 overflow-x-auto">
      {visibleTabs.map((tab) => (
        <Link
          key={tab.id}
          href={`/groups/${groupSlug}?tab=${tab.id}`}
          className={cn(
            'px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
            activeTab === tab.id
              ? 'text-white border-[#ba0963]'
              : 'text-[#a2a8cc] border-transparent hover:text-white hover:border-white/20'
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}
