import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { file_name, content_type, bet_id } = await request.json()

  if (!file_name || !content_type || !bet_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Verify user is a member of the group this bet belongs to
  const { data: bet } = await supabase
    .from('bets')
    .select('group_id')
    .eq('id', bet_id)
    .single() as { data: any }

  if (!bet) {
    return NextResponse.json({ error: 'Bet not found' }, { status: 404 })
  }

  const { data: membership } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', bet.group_id)
    .eq('user_id', user.id)
    .single() as { data: any }

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 })
  }

  const fileExt = file_name.split('.').pop()
  const filePath = `${bet_id}/${user.id}/${Date.now()}.${fileExt}`

  const { data, error } = await supabase.storage
    .from('bet-proofs')
    .createSignedUploadUrl(filePath)

  if (error) {
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 })
  }

  return NextResponse.json({
    signed_url: data.signedUrl,
    token: data.token,
    path: filePath,
  })
}
