import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { bet_id, side, amount } = await request.json()

  if (!bet_id || !side || amount == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!['for', 'against'].includes(side)) {
    return NextResponse.json({ error: 'Invalid side' }, { status: 400 })
  }

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive integer' }, { status: 400 })
  }

  const { data, error } = await (supabase.rpc as any)('buy_shares', {
    p_bet_id: bet_id,
    p_user_id: user.id,
    p_side: side,
    p_amount: amount,
  })

  if (error) {
    return NextResponse.json({ error: 'Failed to place wager' }, { status: 400 })
  }

  // buy_shares returns TABLE(wager_id, shares_received, avg_price)
  // RPC table returns come back as an array
  const result = Array.isArray(data) ? data[0] : data

  return NextResponse.json({
    wager_id: result?.wager_id,
    shares: result?.shares_received,
    avg_price: result?.avg_price,
  })
}
