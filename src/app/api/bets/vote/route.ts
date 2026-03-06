import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { bet_id, vote } = await request.json()

  if (!bet_id || typeof vote !== 'boolean') {
    return NextResponse.json({ error: 'Missing required fields or invalid vote' }, { status: 400 })
  }

  const { data: bet } = await supabase
    .from('bets')
    .select('group_id, resolution_method, status')
    .eq('id', bet_id)
    .single() as { data: any }

  if (!bet) {
    return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
  }

  if (bet.resolution_method !== 'vote') {
    return NextResponse.json({ error: 'This bet is not vote-resolved' }, { status: 400 })
  }

  if (bet.status !== 'open' && bet.status !== 'locked') {
    return NextResponse.json({ error: 'Bet is not active' }, { status: 400 })
  }

  const { data: membership } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', bet.group_id)
    .eq('user_id', user.id)
    .single() as { data: any }

  if (!membership) {
    return NextResponse.json({ error: 'Not a group member' }, { status: 403 })
  }

  const { error } = await supabase.from('bet_votes').insert({
    bet_id,
    user_id: user.id,
    vote,
  })

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You have already voted' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to cast vote' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
