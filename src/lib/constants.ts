export const ACHIEVEMENT_TYPES = {
  first_bet: { title: 'First Blood', description: 'Placed your first bet', icon: '🎯' },
  first_win: { title: 'Winner Winner', description: 'Won your first bet', icon: '🏆' },
  big_winner: { title: 'Big Spender', description: 'Won over 1000 in a single bet', icon: '💰' },
  subject_hero: { title: 'Challenge Accepted', description: 'Completed a challenge as the subject', icon: '🦸' },
  streak_3: { title: 'On Fire', description: 'Won 3 bets in a row', icon: '🔥' },
  all_in_win: { title: 'All In Baby', description: 'Won an all-in bet', icon: '🎰' },
  underdog: { title: 'Underdog', description: 'Won when you were the only one on your side', icon: '🐕' },
} as const

export const BET_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  locked: 'Locked',
  resolved: 'Resolved',
  cancelled: 'Cancelled',
}

export const BET_STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-500/20 text-green-400',
  locked: 'bg-yellow-500/20 text-yellow-400',
  resolved: 'bg-blue-500/20 text-blue-400',
  cancelled: 'bg-red-500/20 text-red-400',
}

export const EXCHANGE_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  claimed: 'Claimed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const EXCHANGE_STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-500/20 text-green-400',
  claimed: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-blue-500/20 text-blue-400',
  cancelled: 'bg-red-500/20 text-red-400',
}

export const MAX_PROOF_SIZE = 50 * 1024 * 1024 // 50MB
export const MAX_BANNER_SIZE = 5 * 1024 * 1024 // 5MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']
