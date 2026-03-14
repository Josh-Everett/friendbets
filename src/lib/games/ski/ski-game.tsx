'use client'

import { useRef, useEffect, useCallback } from 'react'
import type { GameComponentProps } from '../types'

// --- Canvas ---
const W = 400
const H = 600
const SKIER_X = W / 2
const SKIER_Y = 150

// --- Physics ---
const BASE_SPEED = 2.8
const MAX_SPEED_MULT = 2.0
const BOOST_MULT = 1.4
const ACCEL = 0.08
const TURN_SPEED = 6

// Direction: 0=hard left, 1=diag left, 2=slight left, 3=straight, 4=slight right, 5=diag right, 6=hard right
const DIR_VY = [0, 0.4, 0.75, 1.0, 0.75, 0.4, 0] // vertical speed multiplier
const DIR_VX = [-1.0, -0.7, -0.35, 0, 0.35, 0.7, 1.0] // horizontal movement

// --- Obstacles ---
const SPAWN_MARGIN = 80
const TREE_W = 18
const TREE_H = 28
const ROCK_W = 12
const ROCK_H = 8
const RAMP_W = 28
const RAMP_H = 6
const BUMP_W = 14
const BUMP_H = 4
const HIT_SHRINK = 3

// --- Yeti ---
const YETI_SPAWN_DIST = 6000   // ~2000m score
const YETI_SPEED = 6.0          // faster than normal, beatable with turbo
const YETI_HORIZ_SPEED = 3.5    // horizontal tracking
const YETI_START_BEHIND = 350   // world units behind skier at spawn
const YETI_WARN_DIST = 300      // warning starts this far before spawn

type ObstacleType = 'tree' | 'rock' | 'bump' | 'ramp'

interface Obstacle {
  x: number // world x (relative to skier center)
  y: number // world y (distance ahead)
  type: ObstacleType
  w: number
  h: number
  variant: number // visual variation
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
}

interface State {
  phase: 'ready' | 'playing' | 'crashed'
  dir: number // 0-6
  targetDir: number
  speed: number
  worldX: number // skier's horizontal world position
  distance: number // meters traveled
  obstacles: Obstacle[]
  particles: Particle[]
  spawnDist: number
  boost: boolean
  airTime: number // frames in air (from ramp)
  crashTimer: number
  yetiActive: boolean
  yetiDist: number   // world Y
  yetiX: number      // world X
  yetiFrame: number
  yetiWarning: number // countdown frames
  eaten: boolean
}

function fresh(): State {
  return {
    phase: 'ready',
    dir: 3,
    targetDir: 3,
    speed: BASE_SPEED,
    worldX: 0,
    distance: 0,
    obstacles: [],
    particles: [],
    spawnDist: 0,
    boost: false,
    airTime: 0,
    crashTimer: 0,
    yetiActive: false,
    yetiDist: 0,
    yetiX: 0,
    yetiFrame: 0,
    yetiWarning: 0,
    eaten: false,
  }
}

function getSpawnRate(dist: number): number {
  // Spawn every N distance units, gets denser with distance
  return Math.max(28, 60 - Math.floor(dist / 200) * 3)
}

function currentSpeed(s: State): number {
  const distMult = Math.min(1 + s.distance / 5000, MAX_SPEED_MULT)
  const boostMult = s.boost ? BOOST_MULT : 1
  return s.speed * distMult * boostMult
}

// ============================================================
// SPRITE DRAWING
// ============================================================

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, variant: number) {
  const scale = variant === 1 ? 0.7 : 1 // small tree variant
  const w = Math.round(TREE_W * scale)
  const h = Math.round((TREE_H - 4) * scale)
  const cx = x

  // Three layered triangles
  const layers = [
    { yOff: 0, halfW: Math.round(w * 0.15), h: Math.round(h * 0.35) },
    { yOff: Math.round(h * 0.22), halfW: Math.round(w * 0.3), h: Math.round(h * 0.4) },
    { yOff: Math.round(h * 0.45), halfW: Math.round(w * 0.5), h: Math.round(h * 0.55) },
  ]

  for (const layer of layers) {
    const ly = y + layer.yOff
    ctx.fillStyle = '#006600'
    ctx.beginPath()
    ctx.moveTo(cx, ly)
    ctx.lineTo(cx - layer.halfW, ly + layer.h)
    ctx.lineTo(cx + layer.halfW, ly + layer.h)
    ctx.closePath()
    ctx.fill()

    // Lighter edge
    ctx.fillStyle = '#008800'
    ctx.beginPath()
    ctx.moveTo(cx, ly + 1)
    ctx.lineTo(cx + layer.halfW - 1, ly + layer.h - 1)
    ctx.lineTo(cx + 1, ly + layer.h - 1)
    ctx.closePath()
    ctx.fill()
  }

  // Trunk
  const trunkW = Math.max(2, Math.round(3 * scale))
  const trunkH = Math.max(3, Math.round(5 * scale))
  ctx.fillStyle = '#804000'
  ctx.fillRect(cx - Math.floor(trunkW / 2), y + h, trunkW, trunkH)
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#707070'
  ctx.beginPath()
  ctx.moveTo(x - 5, y + ROCK_H)
  ctx.lineTo(x - 6, y + 3)
  ctx.lineTo(x - 2, y)
  ctx.lineTo(x + 3, y + 1)
  ctx.lineTo(x + 6, y + 3)
  ctx.lineTo(x + 5, y + ROCK_H)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#505050'
  ctx.beginPath()
  ctx.moveTo(x - 2, y)
  ctx.lineTo(x + 3, y + 1)
  ctx.lineTo(x + 6, y + 3)
  ctx.lineTo(x + 1, y + 4)
  ctx.lineTo(x - 3, y + 2)
  ctx.closePath()
  ctx.fill()
}

function drawRamp(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const colors = ['#FF0000', '#FF8800', '#FFFF00', '#00CC00', '#0066FF', '#8800FF']
  const stripeH = 1
  for (let i = 0; i < colors.length; i++) {
    ctx.fillStyle = colors[i]
    ctx.fillRect(x - RAMP_W / 2, y + i * stripeH, RAMP_W, stripeH)
  }
}

function drawBump(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#DDDDDD'
  ctx.beginPath()
  ctx.ellipse(x, y + BUMP_H / 2, BUMP_W / 2, BUMP_H / 2, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#CCCCCC'
  ctx.beginPath()
  ctx.ellipse(x, y + BUMP_H / 2 + 1, BUMP_W / 2 - 1, BUMP_H / 2 - 1, 0, Math.PI, Math.PI * 2)
  ctx.fill()
}

// Skier pixel art - each direction is a drawing function
function drawSkier(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, airborne: boolean) {
  ctx.save()
  const cx = x
  const cy = y

  if (airborne) {
    // Shadow on ground
    ctx.fillStyle = 'rgba(0,0,0,0.15)'
    ctx.beginPath()
    ctx.ellipse(cx, cy + 20, 6, 2, 0, 0, Math.PI * 2)
    ctx.fill()
    // Draw skier higher up
    drawSkierSprite(ctx, cx, cy - 8, dir)
  } else {
    drawSkierSprite(ctx, cx, cy, dir)
  }
  ctx.restore()
}

function drawSkierSprite(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: number) {
  // Head
  ctx.fillStyle = '#FFD0A0'
  ctx.fillRect(cx - 2, cy - 8, 4, 4)

  // Body/jacket (red)
  ctx.fillStyle = '#DD0000'
  ctx.fillRect(cx - 3, cy - 4, 6, 5)

  // Pants (blue)
  ctx.fillStyle = '#0000BB'
  ctx.fillRect(cx - 3, cy + 1, 6, 4)

  // Skis based on direction
  ctx.fillStyle = '#000000'
  const skiLen = 10

  if (dir === 3) {
    // Straight down - skis parallel vertical
    ctx.fillRect(cx - 3, cy + 5, 2, skiLen)
    ctx.fillRect(cx + 1, cy + 5, 2, skiLen)
  } else if (dir === 2 || dir === 4) {
    // Slight turn
    const sign = dir < 3 ? -1 : 1
    ctx.save()
    ctx.translate(cx, cy + 8)
    ctx.rotate(sign * 0.3)
    ctx.fillRect(-3, -2, 2, skiLen)
    ctx.fillRect(1, -2, 2, skiLen)
    ctx.restore()
  } else if (dir === 1 || dir === 5) {
    // Diagonal
    const sign = dir < 3 ? -1 : 1
    ctx.save()
    ctx.translate(cx, cy + 8)
    ctx.rotate(sign * 0.65)
    ctx.fillRect(-3, -3, 2, skiLen)
    ctx.fillRect(1, -3, 2, skiLen)
    ctx.restore()
  } else {
    // Hard turn (0 or 6) - skis nearly horizontal
    const sign = dir === 0 ? -1 : 1
    ctx.save()
    ctx.translate(cx, cy + 5)
    ctx.rotate(sign * 1.2)
    ctx.fillRect(-5, -1, skiLen, 2)
    ctx.fillRect(-5, 2, skiLen, 2)
    ctx.restore()
  }

  // Poles
  ctx.fillStyle = '#444444'
  if (dir <= 2) {
    // Leaning left - left pole forward, right back
    ctx.fillRect(cx - 5, cy - 2, 1, 8)
    ctx.fillRect(cx + 4, cy, 1, 6)
  } else if (dir >= 4) {
    // Leaning right
    ctx.fillRect(cx + 4, cy - 2, 1, 8)
    ctx.fillRect(cx - 5, cy, 1, 6)
  } else {
    // Straight - poles symmetric
    ctx.fillRect(cx - 5, cy - 1, 1, 7)
    ctx.fillRect(cx + 4, cy - 1, 1, 7)
  }
}

function drawCrashedSkier(ctx: CanvasRenderingContext2D, x: number, y: number, timer: number) {
  // Tumbled skier with scattered equipment
  const wobble = Math.sin(timer * 0.5) * 2

  // Body sprawled
  ctx.fillStyle = '#DD0000'
  ctx.fillRect(x - 4 + wobble, y - 2, 8, 4)
  ctx.fillStyle = '#0000BB'
  ctx.fillRect(x - 3 + wobble, y + 2, 6, 3)

  // Head
  ctx.fillStyle = '#FFD0A0'
  ctx.fillRect(x - 5 + wobble, y - 3, 3, 3)

  // Scattered skis
  ctx.fillStyle = '#000000'
  ctx.save()
  ctx.translate(x + 6, y - 4)
  ctx.rotate(0.8 + timer * 0.02)
  ctx.fillRect(-1, -5, 2, 10)
  ctx.restore()
  ctx.save()
  ctx.translate(x - 7, y + 5)
  ctx.rotate(-0.5 + timer * 0.01)
  ctx.fillRect(-1, -5, 2, 10)
  ctx.restore()

  // Pole
  ctx.fillStyle = '#444444'
  ctx.save()
  ctx.translate(x + 8, y + 2)
  ctx.rotate(1.2)
  ctx.fillRect(0, 0, 1, 8)
  ctx.restore()
}

function drawYeti(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  const f = Math.floor(frame / 6) % 2

  // Legs (behind body)
  ctx.fillStyle = '#CCCCEE'
  if (f === 0) {
    ctx.fillRect(x - 7, y + 14, 6, 8)
    ctx.fillRect(x + 1, y + 14, 6, 6)
  } else {
    ctx.fillRect(x - 7, y + 14, 6, 6)
    ctx.fillRect(x + 1, y + 14, 6, 8)
  }
  // Feet
  ctx.fillStyle = '#AAAACC'
  ctx.fillRect(x - 8, y + 20 + (f === 0 ? 2 : 0), 7, 3)
  ctx.fillRect(x + 1, y + 20 + (f === 1 ? 2 : 0), 7, 3)

  // Body
  ctx.fillStyle = '#DDDDF0'
  ctx.fillRect(x - 10, y - 6, 20, 22)

  // Fur highlights
  ctx.fillStyle = '#EEEEFF'
  ctx.fillRect(x - 8, y - 4, 5, 3)
  ctx.fillRect(x + 3, y, 5, 3)
  ctx.fillRect(x - 5, y + 6, 4, 3)
  ctx.fillRect(x + 2, y + 10, 4, 3)

  // Arms - animated running
  ctx.fillStyle = '#DDDDF0'
  if (f === 0) {
    ctx.fillRect(x - 16, y - 8, 7, 5)
    ctx.fillRect(x + 9, y + 2, 7, 5)
  } else {
    ctx.fillRect(x + 9, y - 8, 7, 5)
    ctx.fillRect(x - 16, y + 2, 7, 5)
  }
  // Claws
  ctx.fillStyle = '#888899'
  if (f === 0) {
    ctx.fillRect(x - 17, y - 8, 2, 3)
    ctx.fillRect(x + 15, y + 2, 2, 3)
  } else {
    ctx.fillRect(x + 15, y - 8, 2, 3)
    ctx.fillRect(x - 17, y + 2, 2, 3)
  }

  // Head
  ctx.fillStyle = '#DDDDF0'
  ctx.fillRect(x - 8, y - 18, 16, 14)

  // Brow ridge
  ctx.fillStyle = '#CCCCDD'
  ctx.fillRect(x - 7, y - 14, 14, 2)

  // Eyes (angry, dark)
  ctx.fillStyle = '#220000'
  ctx.fillRect(x - 5, y - 12, 3, 3)
  ctx.fillRect(x + 2, y - 12, 3, 3)
  // Eye glint
  ctx.fillStyle = '#FF3333'
  ctx.fillRect(x - 4, y - 11, 1, 1)
  ctx.fillRect(x + 3, y - 11, 1, 1)

  // Mouth (open, angry)
  ctx.fillStyle = '#880000'
  ctx.fillRect(x - 4, y - 7, 8, 3)
  // Teeth
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(x - 3, y - 7, 2, 2)
  ctx.fillRect(x + 1, y - 7, 2, 2)
}

function drawYetiEating(ctx: CanvasRenderingContext2D, x: number, y: number, timer: number) {
  const chomp = Math.floor(timer / 10) % 2

  // Draw yeti standing still, holding skier overhead
  // Body
  ctx.fillStyle = '#DDDDF0'
  ctx.fillRect(x - 10, y - 6, 20, 22)
  ctx.fillStyle = '#EEEEFF'
  ctx.fillRect(x - 8, y - 4, 5, 3)
  ctx.fillRect(x + 3, y, 5, 3)

  // Legs planted
  ctx.fillStyle = '#CCCCEE'
  ctx.fillRect(x - 7, y + 14, 6, 8)
  ctx.fillRect(x + 1, y + 14, 6, 8)
  ctx.fillStyle = '#AAAACC'
  ctx.fillRect(x - 8, y + 22, 7, 3)
  ctx.fillRect(x + 1, y + 22, 7, 3)

  // Arms up holding skier
  ctx.fillStyle = '#DDDDF0'
  ctx.fillRect(x - 14, y - 20, 7, 5)
  ctx.fillRect(x + 7, y - 20, 7, 5)

  // Head with chomping mouth
  ctx.fillStyle = '#DDDDF0'
  ctx.fillRect(x - 8, y - 18, 16, 14)
  ctx.fillStyle = '#CCCCDD'
  ctx.fillRect(x - 7, y - 14, 14, 2)
  ctx.fillStyle = '#220000'
  ctx.fillRect(x - 5, y - 12, 3, 3)
  ctx.fillRect(x + 2, y - 12, 3, 3)
  ctx.fillStyle = '#FF3333'
  ctx.fillRect(x - 4, y - 11, 1, 1)
  ctx.fillRect(x + 3, y - 11, 1, 1)

  // Chomping mouth
  ctx.fillStyle = '#880000'
  ctx.fillRect(x - 4, y - 7, 8, chomp ? 4 : 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(x - 3, y - 7, 2, chomp ? 2 : 1)
  ctx.fillRect(x + 1, y - 7, 2, chomp ? 2 : 1)

  // Skier being held/eaten overhead (flailing)
  const flail = Math.sin(timer * 0.8) * 3
  ctx.fillStyle = '#DD0000'
  ctx.fillRect(x - 3 + flail, y - 28, 6, 4)
  ctx.fillStyle = '#0000BB'
  ctx.fillRect(x - 2 + flail, y - 24, 5, 3)
  ctx.fillStyle = '#FFD0A0'
  ctx.fillRect(x - 1 + flail, y - 30, 3, 3)
  // Tiny flailing limbs
  ctx.fillStyle = '#000000'
  ctx.fillRect(x - 5 + flail, y - 26, 3, 1)
  ctx.fillRect(x + 4 + flail, y - 27, 3, 1)
}

// ============================================================
// GAME COMPONENT
// ============================================================

export function SkiGame({ onGameEnd, onGameStart }: GameComponentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useRef<State>(fresh())
  const raf = useRef(0)
  const endedRef = useRef(false)
  const keysRef = useRef<Set<string>>(new Set())
  const touchRef = useRef<'left' | 'right' | null>(null)

  // Input
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'].includes(e.code)) {
        e.preventDefault()
        keysRef.current.add(e.code)
      }

      const s = state.current
      if (s.phase === 'ready' && (e.code === 'ArrowDown' || e.code === 'Space')) {
        s.phase = 'playing'
        onGameStart()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code)
    }

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      const s = state.current
      if (s.phase === 'ready') {
        s.phase = 'playing'
        onGameStart()
        return
      }
      const rect = cv.getBoundingClientRect()
      const tx = e.touches[0].clientX - rect.left
      const mid = rect.width / 2
      touchRef.current = tx < mid ? 'left' : 'right'
    }

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const rect = cv.getBoundingClientRect()
      const tx = e.touches[0].clientX - rect.left
      const mid = rect.width / 2
      touchRef.current = tx < mid ? 'left' : 'right'
    }

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault()
      touchRef.current = null
    }

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      const s = state.current
      if (s.phase === 'ready') {
        s.phase = 'playing'
        onGameStart()
        return
      }
      const rect = cv.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const mid = rect.width / 2
      touchRef.current = mx < mid ? 'left' : 'right'
    }

    const onMouseUp = () => {
      touchRef.current = null
    }

    cv.addEventListener('touchstart', onTouchStart, { passive: false })
    cv.addEventListener('touchmove', onTouchMove, { passive: false })
    cv.addEventListener('touchend', onTouchEnd, { passive: false })
    cv.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      cv.removeEventListener('touchstart', onTouchStart)
      cv.removeEventListener('touchmove', onTouchMove)
      cv.removeEventListener('touchend', onTouchEnd)
      cv.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [onGameStart])

  // Game loop
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    endedRef.current = false

    function processInput(s: State) {
      const keys = keysRef.current
      const touch = touchRef.current

      if (keys.has('ArrowLeft') || touch === 'left') {
        s.targetDir = Math.max(0, s.targetDir - 1)
      } else if (keys.has('ArrowRight') || touch === 'right') {
        s.targetDir = Math.min(6, s.targetDir + 1)
      } else {
        // Return toward center (straight down)
        if (s.targetDir < 3) s.targetDir++
        else if (s.targetDir > 3) s.targetDir--
      }

      s.boost = keys.has('ArrowDown')
    }

    function spawnObstacles(s: State) {
      const rate = getSpawnRate(s.distance)
      while (s.spawnDist <= s.distance + H) {
        s.spawnDist += rate

        // Spawn 1-3 obstacles per row
        const count = 1 + Math.floor(Math.random() * 2)
        for (let i = 0; i < count; i++) {
          const roll = Math.random() * 1000
          let type: ObstacleType
          let w: number, h: number

          if (roll < 450) {
            type = 'tree'
            w = TREE_W; h = TREE_H
          } else if (roll < 700) {
            type = 'rock'
            w = ROCK_W; h = ROCK_H
          } else if (roll < 950) {
            type = 'bump'
            w = BUMP_W; h = BUMP_H
          } else {
            type = 'ramp'
            w = RAMP_W; h = RAMP_H
          }

          const variant = Math.random() < 0.3 ? 1 : 0
          s.obstacles.push({
            x: (Math.random() - 0.5) * (W + 100),
            y: s.spawnDist + Math.random() * rate,
            type,
            w,
            h,
            variant,
          })
        }
      }
    }

    function update() {
      const s = state.current
      if (s.phase !== 'playing') return

      processInput(s)

      // Smooth direction transition
      if (s.dir < s.targetDir) s.dir = Math.min(s.dir + 0.3, s.targetDir)
      else if (s.dir > s.targetDir) s.dir = Math.max(s.dir - 0.3, s.targetDir)

      const spd = currentSpeed(s)
      const dirIdx = Math.round(s.dir)

      // Move
      const vy = spd * DIR_VY[dirIdx]
      const vx = spd * DIR_VX[dirIdx] * TURN_SPEED

      s.distance += vy
      s.worldX += vx

      // Clamp horizontal to prevent going too far
      s.worldX = Math.max(-800, Math.min(800, s.worldX))

      // Air time countdown
      if (s.airTime > 0) s.airTime--

      // Spawn obstacles
      spawnObstacles(s)

      // Snow spray particles when turning hard
      if (Math.abs(dirIdx - 3) >= 2 && vy > 0) {
        const sign = dirIdx < 3 ? 1 : -1
        for (let i = 0; i < 2; i++) {
          s.particles.push({
            x: SKIER_X + sign * 4,
            y: SKIER_Y + 8 + Math.random() * 4,
            vx: sign * (1 + Math.random() * 2),
            vy: -(0.5 + Math.random()),
            life: 8 + Math.random() * 6,
          })
        }
      }

      // Update particles
      for (const p of s.particles) {
        p.x += p.vx
        p.y += p.vy
        p.life--
      }
      s.particles = s.particles.filter((p) => p.life > 0)

      // Collision detection (skip if airborne)
      if (s.airTime <= 0) {
        for (const obs of s.obstacles) {
          const screenX = W / 2 + (obs.x - s.worldX)
          const screenY = SKIER_Y + (obs.y - s.distance)

          if (screenY < -50 || screenY > H + 50) continue

          // AABB check with shrunk hitbox
          const sl = SKIER_X - 4 + HIT_SHRINK
          const sr = SKIER_X + 4 - HIT_SHRINK
          const st = SKIER_Y - 4 + HIT_SHRINK
          const sb = SKIER_Y + 8 - HIT_SHRINK

          const ol = screenX - obs.w / 2 + HIT_SHRINK
          const or2 = screenX + obs.w / 2 - HIT_SHRINK
          const ot = screenY
          const ob = screenY + obs.h - HIT_SHRINK

          if (sr > ol && sl < or2 && sb > ot && st < ob) {
            if (obs.type === 'tree' || obs.type === 'rock') {
              crash(s)
              return
            } else if (obs.type === 'ramp') {
              s.airTime = 25 + Math.floor(spd * 3)
            }
            // bumps: no crash, just visual
          }
        }
      }

      // --- Yeti ---
      if (!s.yetiActive && s.distance >= YETI_SPAWN_DIST - YETI_WARN_DIST && s.yetiWarning === 0) {
        s.yetiWarning = 120 // 2 seconds of warning
      }

      if (s.yetiWarning > 0) {
        s.yetiWarning--
        if (s.yetiWarning === 0 && !s.yetiActive) {
          s.yetiActive = true
          s.yetiDist = s.distance - YETI_START_BEHIND
          s.yetiX = s.worldX
          s.yetiFrame = 0
        }
      }

      if (s.yetiActive && !s.eaten) {
        s.yetiFrame++
        // Yeti moves downhill at fixed speed
        s.yetiDist += YETI_SPEED
        // Track skier horizontally
        const dx = s.worldX - s.yetiX
        if (Math.abs(dx) > 1) {
          s.yetiX += Math.sign(dx) * Math.min(YETI_HORIZ_SPEED, Math.abs(dx))
        }

        // Check if yeti caught skier
        const yetiScreenY = SKIER_Y + (s.yetiDist - s.distance)
        const yetiScreenX = W / 2 + (s.yetiX - s.worldX)
        if (yetiScreenY >= SKIER_Y - 10 && Math.abs(yetiScreenX - SKIER_X) < 20) {
          s.eaten = true
          s.phase = 'crashed'
          s.crashTimer = 0
          // Snap yeti to skier position
          s.yetiDist = s.distance
          s.yetiX = s.worldX
          if (!endedRef.current) {
            endedRef.current = true
            onGameEnd({ score: Math.floor(s.distance / 3) })
          }
        }
      }

      // Remove obstacles far behind
      s.obstacles = s.obstacles.filter((o) => o.y > s.distance - 100)
    }

    function crash(s: State) {
      s.phase = 'crashed'
      s.crashTimer = 0
      if (!endedRef.current) {
        endedRef.current = true
        onGameEnd({ score: Math.floor(s.distance / 3) })
      }
    }

    function render() {
      const s = state.current
      if (!ctx) return

      // White snow background
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, W, H)

      // Sort obstacles by Y for depth
      const visible: { obs: Obstacle; sx: number; sy: number }[] = []
      for (const obs of s.obstacles) {
        const sx = W / 2 + (obs.x - s.worldX)
        const sy = SKIER_Y + (obs.y - s.distance)
        if (sy > -40 && sy < H + 40 && sx > -30 && sx < W + 30) {
          visible.push({ obs, sx, sy })
        }
      }
      visible.sort((a, b) => a.sy - b.sy)

      // Draw obstacles that are behind the skier
      let skierDrawn = false
      for (const { obs, sx, sy } of visible) {
        if (!skierDrawn && sy > SKIER_Y) {
          drawSkierOrCrash(ctx, s)
          skierDrawn = true
        }

        switch (obs.type) {
          case 'tree':
            drawTree(ctx, sx, sy, obs.variant)
            break
          case 'rock':
            drawRock(ctx, sx, sy)
            break
          case 'ramp':
            drawRamp(ctx, sx, sy)
            break
          case 'bump':
            drawBump(ctx, sx, sy)
            break
        }
      }

      if (!skierDrawn) {
        drawSkierOrCrash(ctx, s)
      }

      // Draw yeti
      if (s.yetiActive) {
        const yetiScreenX = W / 2 + (s.yetiX - s.worldX)
        const yetiScreenY = SKIER_Y + (s.yetiDist - s.distance)
        if (s.eaten) {
          drawYetiEating(ctx, SKIER_X, SKIER_Y, s.crashTimer)
        } else {
          drawYeti(ctx, yetiScreenX, yetiScreenY, s.yetiFrame)
        }
      }

      // Snow spray particles
      for (const p of s.particles) {
        const alpha = p.life / 14
        ctx.fillStyle = `rgba(200, 210, 230, ${alpha})`
        ctx.fillRect(p.x, p.y, 2, 2)
      }

      // Score (distance in meters)
      const meters = Math.floor(s.distance / 3)
      ctx.fillStyle = '#000000'
      ctx.font = 'bold 14px monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`${meters}m`, 12, 24)

      // Speed indicator
      if (s.boost && s.phase === 'playing') {
        ctx.fillStyle = '#CC0000'
        ctx.font = 'bold 11px monospace'
        ctx.fillText('TURBO', 12, 40)
      }

      // Yeti warning
      if (s.yetiWarning > 0 && s.phase === 'playing') {
        const flash = Math.floor(s.yetiWarning / 8) % 2
        if (flash === 0) {
          ctx.fillStyle = '#CC0000'
          ctx.font = 'bold 18px monospace'
          ctx.textAlign = 'center'
          ctx.fillText('WATCH OUT!', W / 2, 60)
          ctx.font = '11px monospace'
          ctx.fillStyle = '#666666'
          ctx.fillText('Something is coming...', W / 2, 78)
          ctx.textAlign = 'left'
        }
      }

      // Ready overlay
      if (s.phase === 'ready') {
        // Dim overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
        ctx.fillRect(0, 0, W, H)

        ctx.fillStyle = '#000000'
        ctx.font = 'bold 22px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('SKI RUN', W / 2, H / 2 - 30)

        ctx.font = '13px monospace'
        ctx.fillStyle = '#444444'
        ctx.fillText('Arrow keys / Tap to steer', W / 2, H / 2)
        ctx.fillText('Down arrow = turbo', W / 2, H / 2 + 20)
        ctx.fillText('Tap or press Down to start', W / 2, H / 2 + 50)
      }

      // Crash overlay
      if (s.phase === 'crashed') {
        s.crashTimer++

        if (s.eaten) {
          // Yeti eating animation plays for a bit, then show score
          if (s.crashTimer > 40) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
            ctx.fillRect(0, 0, W, H)

            ctx.fillStyle = '#CC0000'
            ctx.font = 'bold 24px monospace'
            ctx.textAlign = 'center'
            ctx.fillText('EATEN!', W / 2, H / 2 + 60)

            ctx.fillStyle = '#000000'
            ctx.font = 'bold 36px monospace'
            ctx.fillText(`${meters}m`, W / 2, H / 2 + 100)
          }
        } else {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
          ctx.fillRect(0, 0, W, H)

          ctx.fillStyle = '#CC0000'
          ctx.font = 'bold 24px monospace'
          ctx.textAlign = 'center'
          ctx.fillText('CRASHED!', W / 2, H / 2 - 20)

          ctx.fillStyle = '#000000'
          ctx.font = 'bold 36px monospace'
          ctx.fillText(`${meters}m`, W / 2, H / 2 + 20)
        }
      }
    }

    function drawSkierOrCrash(ctx: CanvasRenderingContext2D, s: State) {
      if (s.eaten) {
        // Yeti eating animation draws the skier — skip here
        return
      }
      if (s.phase === 'crashed') {
        drawCrashedSkier(ctx, SKIER_X, SKIER_Y, s.crashTimer)
      } else {
        drawSkier(ctx, SKIER_X, SKIER_Y, Math.round(s.dir), s.airTime > 0)
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
      className="w-full max-w-[400px] mx-auto block rounded-lg border border-[#ddd]"
      style={{ touchAction: 'none', aspectRatio: `${W}/${H}`, background: '#FFFFFF' }}
    />
  )
}
