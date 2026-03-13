import type { GameDefinition } from './types'

export const GAMES: GameDefinition[] = [
  {
    slug: 'helicopter',
    name: 'HeliRun',
    description: 'Fly through pipes without crashing. Beat the daily high score to win the pool!',
    icon: '\uD83D\uDE81',
    category: 'solo-score',
  },
  {
    slug: 'skirun',
    name: 'SkiRun',
    description: 'Dodge trees and rocks as you race downhill. Beat the high score to win the pool!',
    icon: '\u26F7\uFE0F',
    category: 'solo-score',
  },
]

export function getGameBySlug(slug: string): GameDefinition | undefined {
  return GAMES.find((g) => g.slug === slug)
}
