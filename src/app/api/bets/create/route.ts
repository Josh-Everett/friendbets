import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const {
    group_id,
    title,
    description,
    subject_user_id,
    resolution_method,
    deadline,
    sensitivity,
    creator_side,
    creator_amount
  } = body

  // Validate required fields
  if (!group_id || !title || !creator_side || creator_amount == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (!['for', 'against'].includes(creator_side)) {
    return NextResponse.json({ error: 'Invalid side' }, { status: 400 })
  }

  if (typeof creator_amount !== 'number' || !Number.isInteger(creator_amount) || creator_amount <= 0) {
    return NextResponse.json({ error: 'Amount must be a positive integer' }, { status: 400 })
  }

  if (typeof title !== 'string' || title.length > 200) {
    return NextResponse.json({ error: 'Title must be 200 characters or less' }, { status: 400 })
  }

  if (description && (typeof description !== 'string' || description.length > 2000)) {
    return NextResponse.json({ error: 'Description must be 2000 characters or less' }, { status: 400 })
  }

  const validMethods = ['creator', 'vote']
  const method = validMethods.includes(resolution_method) ? resolution_method : 'creator'

  // Compute virtual_liquidity server-side from sensitivity + group's starting_balance
  const sensitivityMap: Record<string, number> = { low: 0.25, medium: 0.5, high: 1.0 }
  const sensitivityMultiplier = sensitivityMap[sensitivity] ?? 0.5

  const { data: group } = await supabase
    .from('groups')
    .select('starting_balance')
    .eq('id', group_id)
    .single() as { data: any }

  if (!group) {
    return NextResponse.json({ error: 'Group not found' }, { status: 404 })
  }

  const computedLiquidity = Math.round(group.starting_balance * sensitivityMultiplier)
  // Clamp to safe range (validated again in the DB function)
  const virtualLiquidity = Math.max(10, Math.min(100000, computedLiquidity))

  // Call create_market RPC
  const { data, error } = await (supabase.rpc as any)('create_market', {
    p_group_id: group_id,
    p_created_by: user.id,
    p_title: title,
    p_description: description || null,
    p_subject_user_id: subject_user_id || null,
    p_resolution_method: method,
    p_deadline: deadline ? new Date(deadline).toISOString() : null,
    p_virtual_liquidity: virtualLiquidity,
    p_creator_side: creator_side,
    p_creator_amount: creator_amount,
  })

  if (error) {
    return NextResponse.json({ error: 'Failed to create bet' }, { status: 400 })
  }

  return NextResponse.json({ bet_id: data })
}
