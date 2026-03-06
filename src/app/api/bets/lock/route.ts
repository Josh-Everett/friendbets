import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { bet_id } = await request.json()

  if (!bet_id) {
    return NextResponse.json({ error: 'Missing bet_id' }, { status: 400 })
  }

  // Atomic update: only succeeds if bet is open AND caller is creator
  // The trigger guard allows status changes to 'locked' via direct UPDATE
  const { data, error } = await supabase
    .from('bets')
    .update({ status: 'locked' })
    .eq('id', bet_id)
    .eq('status', 'open')
    .eq('created_by', user.id)
    .select('id') as { data: any; error: any }

  if (error) {
    return NextResponse.json({ error: 'Failed to lock bet' }, { status: 400 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Bet not found, not open, or you are not the creator' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
