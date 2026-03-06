'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
  Legend,
} from 'recharts'
import { useSupabase } from '@/hooks/use-supabase'
import { USER_COLORS, getUserColor } from '@/lib/chart-utils'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'

interface BalanceHistoryChartProps {
  groupId: string
  members: Array<{
    user_id: string
    balance: number
    joined_at: string
    profiles?: { username?: string; display_name?: string } | null
  }>
  currencySymbol: string
  startingBalance: number
}

interface DataPoint {
  index: number
  [userId: string]: number
}

function getMemberName(
  member: BalanceHistoryChartProps['members'][number]
): string {
  return (
    member.profiles?.display_name ?? member.profiles?.username ?? 'Unknown'
  )
}

export function BalanceHistoryChart({
  groupId,
  members,
  currencySymbol,
  startingBalance,
}: BalanceHistoryChartProps) {
  const supabase = useSupabase()
  const [loading, setLoading] = useState(true)
  const [chartData, setChartData] = useState<DataPoint[]>([])

  // Sort members by balance descending for color assignment
  // First place gets gold (#fdd160)
  const sortedMembers = [...members].sort((a, b) => b.balance - a.balance)
  const sortedUserIds = sortedMembers.map((m) => m.user_id)

  // Build a lookup for member names
  const memberNameMap = new Map<string, string>()
  for (const member of members) {
    memberNameMap.set(member.user_id, getMemberName(member))
  }

  // Color assignment: first place gets gold, rest use getUserColor
  function getColor(userId: string): string {
    const idx = sortedUserIds.indexOf(userId)
    if (idx === 0) return '#fdd160'
    return getUserColor(userId, sortedUserIds)
  }

  useEffect(() => {
    let cancelled = false

    async function fetchTransactions() {
      setLoading(true)

      const { data } = await supabase
        .from('transactions')
        .select('user_id, balance_after, created_at')
        .eq('group_id', groupId)
        .order('created_at', { ascending: true }) as { data: Array<{
          user_id: string
          balance_after: number
          created_at: string
        }> | null }

      if (cancelled) return

      if (!data || data.length === 0) {
        setChartData([])
        setLoading(false)
        return
      }

      // Initialize all members at starting balance
      const currentBalances: Record<string, number> = {}
      for (const member of members) {
        currentBalances[member.user_id] = startingBalance
      }

      // Build data points from transactions
      const points: DataPoint[] = []

      // First point: everyone at starting balance
      const firstPoint: DataPoint = { index: 0 }
      for (const member of members) {
        firstPoint[member.user_id] = startingBalance
      }
      points.push(firstPoint)

      // Walk through transactions chronologically
      for (let i = 0; i < data.length; i++) {
        const tx = data[i]
        currentBalances[tx.user_id] = tx.balance_after

        const point: DataPoint = { index: i + 1 }
        for (const member of members) {
          point[member.user_id] = currentBalances[member.user_id] ?? startingBalance
        }
        points.push(point)
      }

      // Sample if > 200 transactions to keep chart smooth
      let sampled = points
      if (points.length > 200) {
        const n = Math.ceil(points.length / 200)
        sampled = []
        for (let i = 0; i < points.length; i++) {
          // Always keep first and last
          if (i === 0 || i === points.length - 1 || i % n === 0) {
            sampled.push({ ...points[i], index: sampled.length })
          }
        }
      }

      setChartData(sampled)
      setLoading(false)
    }

    fetchTransactions()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  // Custom tooltip
  function CustomTooltip({ active, payload }: any) {
    if (!active || !payload || payload.length === 0) return null

    // Sort entries by balance descending
    const sorted = [...payload].sort(
      (a: any, b: any) => (b.value as number) - (a.value as number)
    )

    return (
      <div className="bg-[#1a2340] border border-white/10 rounded-lg px-3 py-2 shadow-lg">
        {sorted.map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
            <span
              className="inline-block h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-white">
              {memberNameMap.get(entry.dataKey) ?? 'Unknown'}
            </span>
            <span className="text-[#a2a8cc] ml-auto pl-3">
              {currencySymbol}
              {(entry.value as number).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    )
  }

  // Legend formatter to color each name
  function legendFormatter(value: string) {
    return (
      <span style={{ color: getColor(value), fontSize: 12 }}>
        {memberNameMap.get(value) ?? 'Unknown'}
      </span>
    )
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h3 className="text-sm font-medium text-[#a2a8cc] mb-2">
          Balance History
        </h3>

        {loading ? (
          <div className="flex items-center justify-center h-[240px] sm:h-[280px] lg:h-[320px]">
            <Spinner />
          </div>
        ) : chartData.length === 0 ? (
          <p className="text-[#a2a8cc] text-sm text-center py-8">
            No transaction history yet
          </p>
        ) : (
          <div className="h-[240px] sm:h-[280px] lg:h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="3 3"
                />
                <XAxis dataKey="index" hide />
                <YAxis
                  tick={{ fill: '#a2a8cc', fontSize: 11 }}
                  width={50}
                />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine
                  y={startingBalance}
                  stroke="#a2a8cc"
                  strokeDasharray="3 3"
                  strokeOpacity={0.3}
                  label={{
                    value: 'Start',
                    fill: '#a2a8cc',
                    fontSize: 11,
                    opacity: 0.5,
                  }}
                />
                <Legend formatter={legendFormatter} />
                {members.map((member) => (
                  <Line
                    key={member.user_id}
                    dataKey={member.user_id}
                    type="monotone"
                    stroke={getColor(member.user_id)}
                    strokeWidth={2}
                    dot={false}
                    name={member.user_id}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
