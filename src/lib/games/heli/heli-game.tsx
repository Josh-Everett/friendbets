'use client'

import { useRef, useEffect, useCallback } from 'react'
import type { GameComponentProps } from '../types'

// --- Constants ---
const W = 400
const H = 600
const GRAVITY = 0.38
const FLAP = -6.5
const PLAYER_X = W / 4
const PLAYER_W = 28
const PLAYER_H = 20
const PIPE_W = 52
const GAP = 140
const BASE_SPEED = 2.5
const BASE_SPACING = 220
const MIN_SPACING = 150
const MAX_SPEED_MULT = 2.0
const HIT_PAD = 2

// Colors
const C_BG = '#0f1728'
const C_PIPE = '#1a2340'
const C_PIPE_EDGE = 'rgba(186, 9, 99, 0.35)'
const C_GOLD = '#fdd160'
const C_MUTED = '#a2a8cc'
const C_MAGENTA = '#ba0963'
const C_LINE = 'rgba(255, 255, 255, 0.08)'

interface Pipe {
  x: number
  gapY: number
  scored: boolean
}

interface State {
  phase: 'ready' | 'playing' | 'dead'
  y: number
  vel: number
  pipes: Pipe[]
  score: number
  nextX: number
  deadAt: number
}

function freshState(): State {
  return {
    phase: 'ready',
    y: H / 2 - PLAYER_H / 2,
    vel: 0,
    pipes: [],
    score: 0,
    nextX: W + 80,
    deadAt: 0,
  }
}

function speed(score: number) {
  return BASE_SPEED * Math.min(1 + Math.floor(score / 10) * 0.03, MAX_SPEED_MULT)
}

function spacing(score: number) {
  return Math.max(BASE_SPACING - Math.floor(score / 10) * 8, MIN_SPACING)
}

export function HeliGame({ onGameEnd, onGameStart }: GameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useRef<State>(freshState())
  const raf = useRef(0)
  const endedRef = useRef(false)

  const flap = useCallback(() => {
    const s = state.current
    if (s.phase === 'ready') {
      s.phase = 'playing'
      s.vel = FLAP
      onGameStart()
    } else if (s.phase === 'playing') {
      s.vel = FLAP
    }
  }, [onGameStart])

  // Input
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        if (state.current.phase !== 'dead') flap()
      }
    }
    const onPointer = (e: MouseEvent | TouchEvent) => {
      e.preventDefault()
      if (state.current.phase !== 'dead') flap()
    }

    cv.addEventListener('mousedown', onPointer)
    cv.addEventListener('touchstart', onPointer, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => {
      cv.removeEventListener('mousedown', onPointer)
      cv.removeEventListener('touchstart', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [flap])

  // Game loop
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    endedRef.current = false

    // Pre-compute star positions
    const stars: [number, number][] = []
    for (let i = 0; i < 40; i++) {
      stars.push([(i * 137.5) % W, (i * 89.3) % H])
    }

    function update() {
      const s = state.current
      if (s.phase !== 'playing') return

      const spd = speed(s.score)
      const spc = spacing(s.score)

      // Physics
      s.vel += GRAVITY
      s.y += s.vel

      // Spawn pipes
      if (s.nextX <= W) {
        const minY = GAP / 2 + 40
        const maxY = H - GAP / 2 - 40
        const bias = Math.max(0, 1 - s.score / 50) * 0.4
        const center = H / 2
        const range = (maxY - minY) / 2
        const offset = (Math.random() - 0.5) * 2 * range * (1 - bias)
        const gapY = Math.max(minY, Math.min(maxY, center + offset))
        s.pipes.push({ x: s.nextX, gapY, scored: false })
        s.nextX += spc
      }

      // Move pipes & score
      for (const p of s.pipes) {
        p.x -= spd
        if (!p.scored && p.x + PIPE_W < PLAYER_X) {
          p.scored = true
          s.score++
        }
      }

      // Remove off-screen
      s.pipes = s.pipes.filter((p) => p.x + PIPE_W > -10)
      s.nextX -= spd

      // Collision
      const l = PLAYER_X + HIT_PAD
      const r = PLAYER_X + PLAYER_W - HIT_PAD
      const t = s.y + HIT_PAD
      const b = s.y + PLAYER_H - HIT_PAD

      if (t < 0 || b > H) { die(); return }

      for (const p of s.pipes) {
        if (r > p.x && l < p.x + PIPE_W) {
          const gapTop = p.gapY - GAP / 2
          const gapBot = p.gapY + GAP / 2
          if (t < gapTop || b > gapBot) { die(); return }
        }
      }
    }

    function die() {
      const s = state.current
      s.phase = 'dead'
      s.deadAt = Date.now()
      if (!endedRef.current) {
        endedRef.current = true
        onGameEnd({ score: s.score })
      }
    }

    function render() {
      const s = state.current
      if (!ctx) return

      // Background
      ctx.fillStyle = C_BG
      ctx.fillRect(0, 0, W, H)

      // Stars
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
      for (const [sx, sy] of stars) {
        ctx.fillRect(sx, sy, 2, 2)
      }

      // Floor / ceiling
      ctx.strokeStyle = C_LINE
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, 0.5); ctx.lineTo(W, 0.5)
      ctx.moveTo(0, H - 0.5); ctx.lineTo(W, H - 0.5)
      ctx.stroke()

      // Pipes
      for (const p of s.pipes) {
        const gapTop = p.gapY - GAP / 2
        const gapBot = p.gapY + GAP / 2

        ctx.fillStyle = C_PIPE
        ctx.fillRect(p.x, 0, PIPE_W, gapTop)
        ctx.fillRect(p.x, gapBot, PIPE_W, H - gapBot)

        ctx.strokeStyle = C_PIPE_EDGE
        ctx.lineWidth = 2
        ctx.strokeRect(p.x, 0, PIPE_W, gapTop)
        ctx.strokeRect(p.x, gapBot, PIPE_W, H - gapBot)

        // Pipe cap detail
        ctx.fillStyle = 'rgba(186, 9, 99, 0.12)'
        ctx.fillRect(p.x - 3, gapTop - 6, PIPE_W + 6, 6)
        ctx.fillRect(p.x - 3, gapBot, PIPE_W + 6, 6)
      }

      // Player
      ctx.save()
      ctx.shadowColor = C_GOLD
      ctx.shadowBlur = 14
      ctx.fillStyle = C_GOLD
      ctx.fillRect(PLAYER_X, s.y, PLAYER_W, PLAYER_H)
      ctx.restore()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
      ctx.lineWidth = 1
      ctx.strokeRect(PLAYER_X, s.y, PLAYER_W, PLAYER_H)

      // Tail trail
      if (s.phase === 'playing') {
        ctx.fillStyle = 'rgba(253, 209, 96, 0.3)'
        ctx.fillRect(PLAYER_X - 8, s.y + 4, 8, PLAYER_H - 8)
        ctx.fillStyle = 'rgba(253, 209, 96, 0.15)'
        ctx.fillRect(PLAYER_X - 16, s.y + 6, 8, PLAYER_H - 12)
      }

      // Score
      ctx.save()
      ctx.font = 'bold 36px monospace'
      ctx.textAlign = 'center'
      ctx.shadowColor = C_GOLD
      ctx.shadowBlur = 10
      ctx.fillStyle = C_GOLD
      ctx.fillText(String(s.score), W / 2, 50)
      ctx.restore()

      // Overlays
      if (s.phase === 'ready') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
        ctx.fillRect(0, 0, W, H)

        ctx.font = 'bold 24px monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = '#fff'
        ctx.fillText('TAP TO START', W / 2, H / 2 - 10)

        ctx.font = '13px monospace'
        ctx.fillStyle = C_MUTED
        ctx.fillText('Space / Click / Tap to flap', W / 2, H / 2 + 20)
      }

      if (s.phase === 'dead') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
        ctx.fillRect(0, 0, W, H)

        ctx.font = 'bold 26px monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = C_MAGENTA
        ctx.fillText('GAME OVER', W / 2, H / 2 - 30)

        ctx.save()
        ctx.font = 'bold 48px monospace'
        ctx.shadowColor = C_GOLD
        ctx.shadowBlur = 14
        ctx.fillStyle = C_GOLD
        ctx.fillText(String(s.score), W / 2, H / 2 + 25)
        ctx.restore()
      }
    }

    function loop() {
      update()
      render()
      raf.current = requestAnimationFrame(loop)
    }

    raf.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf.current)
  }, [onGameEnd])

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className="w-full max-w-[400px] mx-auto block rounded-lg border border-white/10"
      style={{ touchAction: 'none', aspectRatio: `${W}/${H}` }}
    />
  )
}
