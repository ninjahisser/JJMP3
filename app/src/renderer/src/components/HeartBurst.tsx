import { useEffect, useRef } from 'react'

// A click on empty background pops a little pixel heart with a few pixel particles.
const HEART = [
  '..XXX...XXX..',
  '.XXXXX.XXXXX.',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '...XXXXXXX...',
  '....XXXXX....',
  '.....XXX.....',
  '......X......'
]
const SHINE = new Set(['1,1', '1,2', '2,1'])
const PX = 5

interface Burst { x: number; y: number; t: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number; kind: 'heart' | 'dot'; color: string }

const INTERACTIVE = 'button, a, input, textarea, select, label, dialog, canvas, [role="radio"], [role="switch"], [contenteditable], .track, .pl-card, .menu, .rail, .picklist, .card, .jobs, .activity, .player, .oled, .dbtns, .tracks, .game-row, nav, .palettes, .theme-switch'

export function HeartBurst() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const bursts: Burst[] = []
    let parts: Particle[] = []
    let raf = 0
    const css = () => getComputedStyle(document.documentElement)
    const resize = () => {
      cv.width = innerWidth
      cv.height = innerHeight
    }
    resize()
    addEventListener('resize', resize)

    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.closest(INTERACTIVE)) return
      bursts.push({ x: e.clientX, y: e.clientY, t: performance.now() })
      const accent = css().getPropertyValue('--accent').trim() || '#c4472b'
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4
        const v = 1.6 + Math.random() * 2.4
        parts.push({ x: e.clientX, y: e.clientY - 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, size: i % 3 === 0 ? 2 : 1, kind: i % 3 === 0 ? 'heart' : 'dot', color: i % 2 ? accent : '#f0a89a' })
      }
      if (!raf) raf = requestAnimationFrame(frame)
    }
    document.addEventListener('click', onClick)

    const drawHeart = (x: number, y: number, px: number, alpha: number, base: string) => {
      ctx.globalAlpha = alpha
      HEART.forEach((row, j) => [...row].forEach((c, i) => {
        if (c !== 'X') return
        ctx.fillStyle = SHINE.has(`${j},${i}`) ? '#f7d5cd' : base
        ctx.fillRect(Math.round(x + (i - 6.5) * px), Math.round(y + (j - 5.5) * px), px, px)
      }))
    }

    const frame = (now: number) => {
      ctx.clearRect(0, 0, cv.width, cv.height)
      const accent = css().getPropertyValue('--accent').trim() || '#c4472b'
      for (let i = bursts.length - 1; i >= 0; i--) {
        const age = (now - bursts[i].t) / 1000
        if (age > 1.1) { bursts.splice(i, 1); continue }
        // pop in with a little overshoot, hold, then rise and fade
        const pop = age < 0.18 ? age / 0.18 : 1
        const scale = pop < 1 ? 0.3 + pop * 1.0 : 1.3 - Math.min(0.3, (age - 0.18) * 1.2)
        const fade = age < 0.6 ? 1 : 1 - (age - 0.6) / 0.5
        const rise = age > 0.6 ? (age - 0.6) * 30 : 0
        drawHeart(bursts[i].x, bursts[i].y - rise, Math.max(1, Math.round(PX * scale)), Math.max(0, fade), accent)
      }
      parts = parts.filter((p) => p.life > 0)
      for (const p of parts) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.09
        p.vx *= 0.985
        p.life -= 0.022
        ctx.globalAlpha = Math.max(0, p.life)
        if (p.kind === 'heart') {
          ctx.fillStyle = p.color
          ;[[1, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [2, 3]].forEach(([dx, dy]) => ctx.fillRect(Math.round(p.x + dx * 2), Math.round(p.y + dy * 2), 2, 2))
        } else {
          ctx.fillStyle = p.color
          ctx.fillRect(Math.round(p.x), Math.round(p.y), 3, 3)
        }
      }
      ctx.globalAlpha = 1
      raf = bursts.length || parts.length ? requestAnimationFrame(frame) : 0
    }

    return () => {
      document.removeEventListener('click', onClick)
      removeEventListener('resize', resize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={ref} className="heart-layer" />
}
