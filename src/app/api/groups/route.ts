import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { name, description, currency_name, currency_symbol, starting_balance } = body

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  if (name.length > 100) {
    return NextResponse.json({ error: 'Name must be 100 characters or less' }, { status: 400 })
  }

  if (description && (typeof description !== 'string' || description.length > 500)) {
    return NextResponse.json({ error: 'Description must be 500 characters or less' }, { status: 400 })
  }

  if (currency_name && (typeof currency_name !== 'string' || currency_name.length > 20)) {
    return NextResponse.json({ error: 'Currency name must be 20 characters or less' }, { status: 400 })
  }

  if (currency_symbol && (typeof currency_symbol !== 'string' || currency_symbol.length > 10)) {
    return NextResponse.json({ error: 'Currency symbol must be 10 characters or less' }, { status: 400 })
  }

  const balance = starting_balance || 1000
  if (typeof balance !== 'number' || !Number.isInteger(balance) || balance < 100 || balance > 1000000) {
    return NextResponse.json({ error: 'Starting balance must be an integer between 100 and 1,000,000' }, { status: 400 })
  }

  // Use atomic create_group RPC — creates group + admin member + invite code in one transaction
  const { data: group_id, error } = await (supabase.rpc as any)('create_group', {
    p_name: name,
    p_description: description || null,
    p_currency_name: currency_name || null,
    p_currency_symbol: currency_symbol || null,
    p_starting_balance: balance,
  })

  if (error) {
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 })
  }

  return NextResponse.json({ id: group_id })
}
