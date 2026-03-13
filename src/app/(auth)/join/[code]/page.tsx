import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { JoinGroupClient } from './join-client'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('invite_codes')
    .select('*, groups(*)')
    .eq('code', code.toUpperCase())
    .single() as { data: any }

  if (!invite?.groups) {
    return { title: 'Join Group' }
  }

  const group = invite.groups
  const title = `Join ${group.name}`
  const description = group.description
    || `You've been invited to ${group.name} on FriendBets! Start with ${group.currency_symbol}${group.starting_balance.toLocaleString()} ${group.currency_name}.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()

  // Fetch invite code and group info using admin client (bypasses RLS for unauthenticated visitors)
  const { data: invite } = await admin
    .from('invite_codes')
    .select('*, groups(*)')
    .eq('code', code.toUpperCase())
    .single() as { data: any }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Invalid Invite Code</h1>
          <p className="text-[#a2a8cc]">This invite link is invalid or has expired.</p>
          {!user && (
            <p className="text-[#a2a8cc] mt-4">
              <a href="/login" className="text-[#ba0963] hover:underline">Sign in</a> or{' '}
              <a href="/signup" className="text-[#ba0963] hover:underline">create an account</a>
            </p>
          )}
        </div>
      </div>
    )
  }

  // Check expiry and usage
  const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date()
  const isUsedUp = invite.max_uses && invite.use_count >= invite.max_uses

  if (isExpired || isUsedUp) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Invite Expired</h1>
          <p className="text-[#a2a8cc]">This invite link is no longer valid.</p>
        </div>
      </div>
    )
  }

  if (!user) {
    // Not logged in - redirect to signup with return URL
    redirect(`/signup?next=/join/${code}`)
  }

  // Check if already a member
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', invite.group_id)
    .eq('user_id', user.id)
    .single()

  const group = invite.groups as any

  if (existingMember) {
    redirect(`/groups/${group.slug}`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <JoinGroupClient
        groupName={group.name}
        groupDescription={group.description}
        currencyName={group.currency_name}
        currencySymbol={group.currency_symbol}
        startingBalance={group.starting_balance}
        inviteCode={code.toUpperCase()}
        groupSlug={group.slug}
      />
    </div>
  )
}
