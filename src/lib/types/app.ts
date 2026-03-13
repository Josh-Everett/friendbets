import type { Database } from './database'

// Table row types
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Group = Database['public']['Tables']['groups']['Row']
export type GroupMember = Database['public']['Tables']['group_members']['Row']
export type InviteCode = Database['public']['Tables']['invite_codes']['Row']
export type Bet = Database['public']['Tables']['bets']['Row']
export type BetWager = Database['public']['Tables']['bet_wagers']['Row']
export type BetVote = Database['public']['Tables']['bet_votes']['Row']
export type BetProof = Database['public']['Tables']['bet_proofs']['Row']
export type Achievement = Database['public']['Tables']['achievements']['Row']
export type Transaction = Database['public']['Tables']['transactions']['Row']
export type Season = Database['public']['Tables']['seasons']['Row']

// Enriched types for UI
export type GroupWithMemberCount = Group & { member_count: number }
export type GroupMemberWithProfile = GroupMember & { profiles: Profile }
export type BetWithCreator = Bet & { profiles: Profile }
export type BetWagerWithProfile = BetWager & { profiles: Profile }
export type BetDetail = Bet & {
  profiles: Profile
  subject: Profile | null
  bet_wagers: BetWagerWithProfile[]
  bet_votes: BetVote[]
  bet_proofs: BetProof[]
}

export type BetStatus = 'open' | 'locked' | 'resolved' | 'cancelled'
export type WagerSide = 'for' | 'against'
export type GroupRole = 'admin' | 'member'
export type ResolutionMethod = 'creator' | 'vote'

export type AchievementType =
  | 'first_bet'
  | 'first_win'
  | 'big_winner'
  | 'subject_hero'
  | 'streak_3'
  | 'all_in_win'
  | 'underdog'

// AMM-related types
export type OddsInfo = {
  yesPrice: number
  noPrice: number
  yesOdds: string
  noOdds: string
  yesProbability: string
  noProbability: string
}

export type TradePreview = {
  shares: number
  avgPrice: number
  priceImpact: number
  estimatedPayout: number
}

export type SeasonRanking = {
  user_id: string
  username: string
  display_name: string | null
  final_balance: number
  profit: number
  rank: number
}

// Game types
export type GamePool = Database['public']['Tables']['game_pools']['Row']
export type GamePlay = Database['public']['Tables']['game_plays']['Row']
export type GamePlayWithProfile = GamePlay & { profiles: Profile }
