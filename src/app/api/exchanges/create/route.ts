import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { group_id, title, description, reward } = await request.json()

  if (!group_id || !title || !reward || reward <= 0) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { data, error } = await (supabase.rpc as any)('create_exchange', {
    p_group_id: group_id,
    p_created_by: user.id,
    p_title: title,
    p_description: description || null,
    p_reward: reward,
  })

  if (error) {
    return NextResponse.json({ error: error.message || 'Failed to create exchange' }, { status: 400 })
  }

  return NextResponse.json({ id: data })
}
