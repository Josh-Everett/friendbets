'use client'

import { GameWrapper } from '@/components/games/game-wrapper'
import { HeliGame } from '@/lib/games/heli'
import { SkiGame } from '@/lib/games/ski'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'

interface GamePageProps {
  groupId: string
  groupSlug: string
  gameSlug: string
  gameName: string
  gameIcon: string
  userId: string
  userBalance: number
  currencySymbol: string
  dailyHigh: number | null
  dailyHighUser: string | null
  allTimeHigh: number | null
  allTimeHighUser: string | null
  prizePool: number
  todayPlays: Array<{
    id: string
    user_id: string
    score: number
    bet_amount: number
    payout: number
    is_winner: boolean
    created_at: string
    profiles: { username: string; display_name: string | null }
  }>
}

const GAME_COMPONENTS: Record<string, React.ComponentType<any>> = {
  helicopter: HeliGame,
  skirun: SkiGame,
}

export function GamePage({
  groupId,
  groupSlug,
  gameSlug,
  gameName,
  gameIcon,
  userId,
  userBalance,
  currencySymbol,
  dailyHigh,
  dailyHighUser,
  allTimeHigh,
  allTimeHighUser,
  prizePool,
  todayPlays,
}: GamePageProps) {
  const GameComponent = GAME_COMPONENTS[gameSlug]

  return (
    <div className="space-y-6">
      <GameWrapper
        groupId={groupId}
        groupSlug={groupSlug}
        gameSlug={gameSlug}
        gameName={gameName}
        gameIcon={gameIcon}
        userId={userId}
        userBalance={userBalance}
        currencySymbol={currencySymbol}
        dailyHigh={dailyHigh}
        dailyHighUser={dailyHighUser}
        allTimeHigh={allTimeHigh}
        allTimeHighUser={allTimeHighUser}
        prizePool={prizePool}
      >
        {({ onGameEnd, onGameStart }) => (
          <GameComponent onGameEnd={onGameEnd} onGameStart={onGameStart} />
        )}
      </GameWrapper>

      {/* Today's scores */}
      {todayPlays.length > 0 && (
        <div className="max-w-lg mx-auto">
          <Card>
            <CardContent className="py-4">
              <h3 className="text-sm font-semibold text-white mb-3">Today&apos;s Scores</h3>
              <div className="space-y-2">
                {todayPlays.map((play, i) => (
                  <div key={play.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-[#a2a8cc] w-5 text-right">{i + 1}.</span>
                      <span className="text-white">
                        {play.profiles?.display_name || play.profiles?.username}
                      </span>
                      {play.is_winner && (
                        <span className="text-[#fdd160] text-xs font-semibold">POOL WIN</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-white">{play.score}</span>
                      {play.bet_amount > 0 && (
                        <span className={`text-xs ${play.is_winner ? 'text-[#fdd160]' : 'text-[#a2a8cc]'}`}>
                          {play.is_winner
                            ? `+${formatCurrency(play.payout, currencySymbol)}`
                            : `-${formatCurrency(play.bet_amount, currencySymbol)}`
                          }
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
