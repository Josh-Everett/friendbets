import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALLOWED_IMAGE_TYPES } from '@/lib/constants'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { file_name, content_type, group_id } = await request.json()

  if (!file_name || !content_type || !group_id) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!ALLOWED_IMAGE_TYPES.includes(content_type)) {
    return NextResponse.json(
      { error: 'File type not allowed. Accepted: JPEG, PNG, GIF, WebP' },
      { status: 400 }
    )
  }

  // Verify user is an admin of this group
  const { data: membership } = await supabase
    .from('group_members')
    .select('role')
    .eq('group_id', group_id)
    .eq('user_id', user.id)
    .single() as { data: any }

  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Only group admins can update the banner' }, { status: 403 })
  }

  const fileExt = file_name.split('.').pop()
  const filePath = `${group_id}/${user.id}/${Date.now()}.${fileExt}`

  const { data, error } = await supabase.storage
    .from('group-banners')
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
