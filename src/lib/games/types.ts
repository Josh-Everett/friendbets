export interface GameDefinition {
  slug: string
  name: string
  description: string
  icon: string // emoji
  category: 'solo-score'
}

export interface GameResult {
  score: number
  metadata?: Record<string, unknown>
}

export interface GameComponentProps {
  onGameEnd: (result: GameResult) => void
  onGameStart: () => void
}
