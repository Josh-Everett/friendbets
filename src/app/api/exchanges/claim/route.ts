import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { exchange_id, action } = await request.json()

  if (!exchange_id || !action || !['claim', 'unclaim'].includes(action)) {
    return NextResponse.json({ error: 'Missing exchange_id or invalid action' }, { status: 400 })
  }

  if (action === 'claim') {
    // Fetch exchange to validate
    const { data: exchange } = await supabase
      .from('exchanges')
      .select('created_by, status')
      .eq('id', exchange_id)
      .single() as { data: any }

    if (!exchange) {
      return NextResponse.json({ error: 'Exchange not found' }, { status: 404 })
    }

    // Prevent self-claim
    if (exchange.created_by === user.id) {
      return NextResponse.json({ error: 'Cannot claim your own exchange' }, { status: 400 })
    }

    // Atomic update: only succeeds if status is still 'open'
    const { data, error } = await supabase
      .from('exchanges')
      .update({
        status: 'claimed',
        claimed_by: user.id,
        claimed_at: new Date().toISOString(),
      })
      .eq('id', exchange_id)
      .eq('status', 'open')
      .select('id') as { data: any; error: any }

    if (error) {
      return NextResponse.json({ error: 'Failed to claim exchange' }, { status: 400 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Exchange is no longer available' }, { status: 400 })
    }
  } else {
    // Unclaim: only the claimer can release
    const { data, error } = await supabase
      .from('exchanges')
      .update({
        status: 'open',
        claimed_by: null,
        claimed_at: null,
      })
      .eq('id', exchange_id)
      .eq('status', 'claimed')
      .eq('claimed_by', user.id)
      .select('id') as { data: any; error: any }

    if (error) {
      return NextResponse.json({ error: 'Failed to release exchange' }, { status: 400 })
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Exchange not found or you are not the claimer' }, { status: 400 })
    }
  }

  return NextResponse.json({ success: true })
}
