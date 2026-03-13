import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGameBySlug } from '@/lib/games/registry'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { group_id, game_type, score, bet_amount = 0, metadata = {} } = await request.json()

  if (!group_id || !game_type || score == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!getGameBySlug(game_type)) {
    return NextResponse.json({ error: 'Unknown game type' }, { status: 400 })
  }

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 9999) {
    return NextResponse.json({ error: 'Invalid score' }, { status: 400 })
  }

  if (typeof bet_amount !== 'number' || !Number.isInteger(bet_amount) || bet_amount < 0) {
    return NextResponse.json({ error: 'Invalid bet amount' }, { status: 400 })
  }

  const { data, error } = await (supabase.rpc as any)('submit_game_score', {
    p_group_id: group_id,
    p_user_id: user.id,
    p_game_type: game_type,
    p_score: score,
    p_bet_amount: bet_amount,
    p_result: metadata,
  })

  if (error) {
    const msg = error.message || 'Failed to submit score'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  return NextResponse.json(data)
}
