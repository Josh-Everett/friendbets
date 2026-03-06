import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { code } = await request.json()

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Missing invite code' }, { status: 400 })
  }

  // Use atomic join_group RPC — validates code, checks limits, joins, increments use_count
  const { data: group_id, error } = await (supabase.rpc as any)('join_group', {
    p_code: code,
  })

  if (error) {
    // Map known errors to user-friendly messages
    const msg = error.message as string
    if (msg.includes('Invalid invite code')) {
      return NextResponse.json({ error: 'Invalid invite code' }, { status: 400 })
    }
    if (msg.includes('expired')) {
      return NextResponse.json({ error: 'Invite code has expired' }, { status: 400 })
    }
    if (msg.includes('fully used')) {
      return NextResponse.json({ error: 'Invite code has been fully used' }, { status: 400 })
    }
    if (msg.includes('Already a member')) {
      return NextResponse.json({ error: 'Already a member of this group' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to join group' }, { status: 400 })
  }

  return NextResponse.json({ success: true, group_id })
}
