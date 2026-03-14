import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { exchange_id } = await request.json()

  if (!exchange_id) {
    return NextResponse.json({ error: 'Missing exchange_id' }, { status: 400 })
  }

  const { error } = await (supabase.rpc as any)('cancel_exchange', {
    p_exchange_id: exchange_id,
    p_cancelled_by: user.id,
  })

  if (error) {
    return NextResponse.json({ error: error.message || 'Failed to cancel exchange' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
