import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { bet_id, outcome } = await request.json()

  if (!bet_id || typeof outcome !== 'boolean') {
    return NextResponse.json({ error: 'Missing required fields or invalid outcome' }, { status: 400 })
  }

  const { data: bet } = await supabase
    .from('bets')
    .select('created_by, group_id')
    .eq('id', bet_id)
    .single() as { data: any }

  if (!bet) {
    return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
  }

  const { data: membership } = await supabase
    .from('group_members')
    .select('role')
    .eq('group_id', bet.group_id)
    .eq('user_id', user.id)
    .single() as { data: any }

  if (bet.created_by !== user.id && membership?.role !== 'admin') {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const { error } = await (supabase.rpc as any)('resolve_market', {
    p_bet_id: bet_id,
    p_outcome: outcome,
    p_resolved_by: user.id,
  })

  if (error) {
    return NextResponse.json({ error: 'Failed to resolve bet' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
