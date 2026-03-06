'use client'

import { useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts'
import { buildOddsHistory } from '@/lib/chart-utils'

interface OddsChartProps {
  wagers: Array<{
    created_at: string
    side: 'for' | 'against'
    amount: number
    shares?: number
    price_avg?: number
    profiles?: { username?: string; display_name?: string } | null
  }>
  virtualLiquidity: number
  betCreatedAt: string
  status: 'open' | 'locked' | 'resolved' | 'cancelled'
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: { label: string; side: string; amount: number; yesPrice: number } }>
}) {
  if (!active || !payload || payload.length === 0) return null

  const data = payload[0].payload

  if (data.label === 'Start') {
    return (
      <div className="bg-[#1a2340] border border-white/10 rounded-lg px-3 py-2 shadow-lg">
        <p className="text-sm text-white">Initial odds: 50%</p>
      </div>
    )
  }

  return (
    <div className="bg-[#1a2340] border border-white/10 rounded-lg px-3 py-2 shadow-lg">
      <p className="text-sm text-white font-medium">{data.label}</p>
      <p className="text-xs mt-0.5">
        <span className={data.side === 'for' ? 'text-[#34d399]' : 'text-[#ef4444]'}>
          {data.side === 'for' ? 'For' : 'Against'}
        </span>
        <span className="text-[#a2a8cc]"> &middot; {data.amount} coins</span>
      </p>
      <p className="text-xs text-[#a2a8cc] mt-0.5">
        &rarr; {data.yesPrice.toFixed(1)}%
      </p>
    </div>
  )
}

export function OddsChart({ wagers, virtualLiquidity, betCreatedAt }: OddsChartProps) {
  const data = useMemo(
    () => buildOddsHistory(wagers, virtualLiquidity, betCreatedAt),
    [wagers, virtualLiquidity, betCreatedAt],
  )

  const isEmpty = data.length <= 1

  return (
    <div>
      <h3 className="text-sm font-medium text-[#a2a8cc] mb-2">Odds Movement</h3>
      <div className="h-[200px] sm:h-[240px] lg:h-[280px]">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[#a2a8cc] text-sm">No wagers yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="oddsAreaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(52,211,153,0.1)" />
                  <stop offset="100%" stopColor="rgba(52,211,153,0)" />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
              <XAxis dataKey="index" hide />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tick={{ fill: '#a2a8cc', fontSize: 11 }}
                tickFormatter={(value: number) => `${value}%`}
                width={40}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine
                y={50}
                stroke="#a2a8cc"
                strokeDasharray="4 4"
                strokeOpacity={0.3}
              />
              <Area
                type="monotone"
                dataKey="yesPrice"
                stroke="none"
                fill="url(#oddsAreaFill)"
                animationDuration={500}
              />
              <Line
                type="monotone"
                dataKey="yesPrice"
                stroke="#34d399"
                strokeWidth={2}
                dot={{ r: 4, fill: '#1a2340', stroke: '#34d399' }}
                animationDuration={500}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
