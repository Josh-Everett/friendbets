import { SupabaseClient } from '@supabase/supabase-js'

export async function creditDailyAllowance(
  supabase: SupabaseClient,
  groupId: string,
  userId: string
): Promise<number> {
  const { data, error } = await (supabase.rpc as any)('credit_daily_allowance', {
    p_group_id: groupId,
    p_user_id: userId,
  })

  if (error) {
    console.error('Failed to credit daily allowance:', error.message)
    return 0
  }

  return data ?? 0
}
