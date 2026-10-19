import { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { useStore } from '../store'

// The panel is two-colour: rows 0-15 glow yellow, the rest blue
const YELLOW = [255, 214, 64]
const BLUE = [120, 206, 255]
const OFF = [5, 6, 8]

// A button press asks for the next frame right away instead of waiting for the poll
let refreshNow: (() => void) | null = null
let fastUntil = 0

/** The player's five buttons, for using its menus from here until the real ones are wired. */
function DeviceButtons() {
  const press = (k: string) => {
    let held = false
    const timer = setTimeout(() => {
      held = true
      void window.jjmp3.invoke('btn', k, true)
      fastUntil = performance.now() + 2500
      refreshNow?.()
    }, 550)
    const up = () => {
      clearTimeout(timer)
      window.removeEventListener('pointerup', up)
      if (!held) void window.jjmp3.invoke('btn', k, false)
      fastUntil = performance.now() + 2500
      refreshNow?.()
    }
    window.addEventListener('pointerup', up)
  }
  const B = ({ k, icon, label, wide }: { k: string; icon?: string; label?: string; wide?: boolean }) => (
    <button className={`dbtn ${wide ? 'wide' : ''}`} title={k === 'play' ? 'Select / play-pause (hold: back)' : k} onPointerDown={() => press(k)}>
      {icon ? <Icon name={icon} size={15} /> : label}
    </button>
  )
  return (
    <div className="dbtns">
      <B k="down" icon="minus" />
      <B k="left" icon="left" />
      <B k="play" label="P" wide />
      <B k="right" icon="right" />
      <B k="up" icon="plus" />
    </div>
  )
}

/** Live mirror of the player's 128x64 OLED (SSD1306 page layout), plus its buttons. */
export function Oled() {
  const connected = useStore((s) => s.snap.device.connected)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!connected) return
    let alive = true
    const ctx = canvas.current!.getContext('2d')!
    const img = ctx.createImageData(128, 64)
    const loop = async () => {
      while (alive) {
        const buf = await window.jjmp3.invoke<Uint8Array | null>('screen').catch(() => null)
        if (buf && alive) {
          for (let page = 0; page < 8; page++)
            for (let x = 0; x < 128; x++) {
              const byte = buf[page * 128 + x]
              for (let bit = 0; bit < 8; bit++) {
                const y = page * 8 + bit
                const o = (y * 128 + x) * 4
                const c = (byte >> bit) & 1 ? (y < 16 ? YELLOW : BLUE) : OFF
                img.data[o] = c[0]
                img.data[o + 1] = c[1]
                img.data[o + 2] = c[2]
                img.data[o + 3] = 255
              }
            }
          ctx.putImageData(img, 0, 0)
        }
        const wait = document.hidden ? 2000 : performance.now() < fastUntil ? 90 : 400
        await new Promise<void>((r) => {
          const t = setTimeout(r, wait)
          refreshNow = () => {
            clearTimeout(t)
            r()
          }
        })
      }
    }
    void loop()
    return () => {
      alive = false
      refreshNow = null
    }
  }, [connected])

  return (
    <div className="device-face">
      <div className="oled" title="Live view of the player's screen">
        <canvas ref={canvas} width={128} height={64} hidden={!connected} />
        {!connected && <div className="off">not connected</div>}
      </div>
      {connected && <DeviceButtons />}
    </div>
  )
}