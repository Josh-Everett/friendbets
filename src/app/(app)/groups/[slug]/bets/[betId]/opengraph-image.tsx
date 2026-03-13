import { ImageResponse } from 'next/og'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'edge'
export const alt = 'Bet on FriendBets'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ slug: string; betId: string }> }) {
  const { slug, betId } = await params
  const supabase = await createClient()

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, currency_symbol')
    .eq('slug', slug)
    .single() as { data: any }

  const { data: bet } = group ? await supabase
    .from('bets')
    .select('title, description, status, bet_wagers(amount, side)')
    .eq('group_id', group.id)
    .eq('short_id', betId)
    .single() as { data: any } : { data: null }

  const title = bet?.title ?? 'Bet'
  const status = bet?.status ?? 'open'
  const currencySymbol = group?.currency_symbol ?? '$'
  const groupName = group?.name ?? ''

  const totalFor = bet?.bet_wagers?.filter((w: any) => w.side === 'for').reduce((s: number, w: any) => s + w.amount, 0) ?? 0
  const totalAgainst = bet?.bet_wagers?.filter((w: any) => w.side === 'against').reduce((s: number, w: any) => s + w.amount, 0) ?? 0
  const totalPool = totalFor + totalAgainst
  const forPct = totalPool > 0 ? Math.round((totalFor / totalPool) * 100) : 50
  const againstPct = 100 - forPct

  const statusColors: Record<string, string> = {
    open: '#22c55e',
    locked: '#f59e0b',
    resolved: '#a2a8cc',
    cancelled: '#ef4444',
  }

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0f1728 0%, #1a2340 50%, #151d30 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '60px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
          <span style={{ fontSize: 28, color: '#ba0963', fontWeight: 700 }}>FriendBets</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {groupName && <span style={{ fontSize: 20, color: '#a2a8cc' }}>{groupName}</span>}
            <span
              style={{
                fontSize: 16,
                color: '#fff',
                background: statusColors[status] ?? '#a2a8cc',
                padding: '6px 16px',
                borderRadius: '999px',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              {status}
            </span>
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 52,
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.2,
            marginBottom: '40px',
            flex: 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {title}
        </div>

        {/* Pool + Odds Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 22 }}>
            <span style={{ color: '#22c55e', fontWeight: 600 }}>For {forPct}% ({currencySymbol}{totalFor.toLocaleString()})</span>
            <span style={{ color: '#fdd160', fontWeight: 700 }}>Pool: {currencySymbol}{totalPool.toLocaleString()}</span>
            <span style={{ color: '#ef4444', fontWeight: 600 }}>Against {againstPct}% ({currencySymbol}{totalAgainst.toLocaleString()})</span>
          </div>
          <div style={{ display: 'flex', height: '20px', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ width: `${forPct}%`, background: '#22c55e' }} />
            <div style={{ width: `${againstPct}%`, background: '#ef4444' }} />
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
