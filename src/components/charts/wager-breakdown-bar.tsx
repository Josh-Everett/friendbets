'use client'

import { useMemo } from 'react'
import { buildWagerBreakdown, type Segment } from '@/lib/chart-utils'
import { formatCurrency } from '@/lib/utils'

interface WagerBreakdownBarProps {
  wagers: Array<{
    user_id: string
    side: 'for' | 'against'
    amount: number
    profiles?: { username?: string; display_name?: string } | null
  }>
  currencySymbol: string
}

export function WagerBreakdownBar({ wagers, currencySymbol }: WagerBreakdownBarProps) {
  const breakdown = useMemo(() => buildWagerBreakdown(wagers), [wagers])

  if (breakdown.forTotal + breakdown.againstTotal === 0) {
    return null
  }

  // Collect unique users across both sides for the legend
  const uniqueUsers = useMemo(() => {
    const seen = new Map<string, { username: string; color: string; amount: number }>()
    for (const seg of [...breakdown.forSegments, ...breakdown.againstSegments]) {
      const existing = seen.get(seg.userId)
      if (existing) {
        existing.amount += seg.amount
      } else {
        seen.set(seg.userId, { username: seg.username, color: seg.color, amount: seg.amount })
      }
    }
    return Array.from(seen.values())
  }, [breakdown])

  return (
    <div>
      <h3 className="text-sm font-medium text-[#a2a8cc] mb-3">Wager Breakdown</h3>

      <div className="space-y-2">
        {/* For row */}
        <SideRow
          label="For"
          labelClass="text-green-400"
          segments={breakdown.forSegments}
          total={breakdown.forTotal}
          currencySymbol={currencySymbol}
        />

        {/* Against row */}
        <SideRow
          label="Against"
          labelClass="text-red-400"
          segments={breakdown.againstSegments}
          total={breakdown.againstTotal}
          currencySymbol={currencySymbol}
        />
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {uniqueUsers.map((user) => (
          <div key={user.username} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: user.color }}
            />
            <span className="text-white text-xs">{user.username}</span>
            <span className="text-[#a2a8cc] text-xs">
              {formatCurrency(user.amount, currencySymbol)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SideRow({
  label,
  labelClass,
  segments,
  total,
  currencySymbol,
}: {
  label: string
  labelClass: string
  segments: Segment[]
  total: number
  currencySymbol: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium ${labelClass}`}>{label}</span>
        <span className="text-xs text-[#a2a8cc]">
          {formatCurrency(total, currencySymbol)}
        </span>
      </div>
      <div className="h-8 rounded-md bg-[#1a2340] overflow-hidden flex flex-row">
        {segments.length === 0 ? (
          <div className="flex items-center justify-center w-full">
            <span className="text-[#a2a8cc] text-xs">No wagers</span>
          </div>
        ) : (
          segments.map((seg, i) => (
            <div
              key={seg.userId}
              className={`min-w-[4px] ${i < segments.length - 1 ? 'border-r border-[#0f1728]' : ''}`}
              style={{
                width: `${seg.percentage}%`,
                backgroundColor: seg.color,
              }}
              title={`${seg.username}: ${formatCurrency(seg.amount, currencySymbol)}`}
            />
          ))
        )}
      </div>
    </div>
  )
}
