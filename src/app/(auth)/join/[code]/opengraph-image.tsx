import { ImageResponse } from 'next/og'
import { createAdminClient } from '@/lib/supabase/admin'

export const alt = 'Join group on FriendBets'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('invite_codes')
    .select('*, groups(*)')
    .eq('code', code.toUpperCase())
    .single() as { data: any }

  const group = invite?.groups
  const groupName = group?.name ?? 'Unknown Group'
  const description = group?.description ?? 'Bet on your friends with fake money'
  const balance = group ? `${group.currency_symbol}${group.starting_balance.toLocaleString()}` : ''

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0f1728 0%, #1a2340 50%, #151d30 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
          padding: '60px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '20px',
          }}
        >
          <span style={{ fontSize: 28, color: '#ba0963', fontWeight: 700 }}>FriendBets</span>
        </div>
        <div
          style={{
            fontSize: 24,
            color: '#a2a8cc',
            marginBottom: '16px',
            textTransform: 'uppercase',
            letterSpacing: '3px',
          }}
        >
          You&apos;re Invited
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 700,
            color: '#ffffff',
            textAlign: 'center',
            marginBottom: '16px',
            lineHeight: 1.2,
          }}
        >
          {groupName}
        </div>
        {description && (
          <div
            style={{
              fontSize: 22,
              color: '#a2a8cc',
              textAlign: 'center',
              marginBottom: '32px',
              maxWidth: '800px',
            }}
          >
            {description}
          </div>
        )}
        {balance && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              background: 'rgba(253, 209, 96, 0.1)',
              border: '2px solid rgba(253, 209, 96, 0.3)',
              borderRadius: '16px',
              padding: '16px 32px',
            }}
          >
            <span style={{ fontSize: 20, color: '#a2a8cc' }}>Starting balance:</span>
            <span style={{ fontSize: 32, fontWeight: 700, color: '#fdd160' }}>{balance}</span>
          </div>
        )}
      </div>
    ),
    { ...size }
  )
}
