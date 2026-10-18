import { useEffect, useRef } from 'react'
import { useStore } from '../store'

// The panel is two-colour: rows 0-15 glow yellow, the rest blue
const YELLOW = [255, 214, 64]
const BLUE = [120, 206, 255]
const OFF = [5, 6, 8]

/** Live mirror of the player's 128x64 OLED (SSD1306 page layout). */
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
        await new Promise((r) => setTimeout(r, document.hidden ? 2000 : 400))
      }
    }
    void loop()
    return () => {
      alive = false
    }
  }, [connected])

  return (
    <div className="oled" title="Live view of the player's screen">
      <canvas ref={canvas} width={128} height={64} hidden={!connected} />
      {!connected && <div className="off">not connected</div>}
    </div>
  )
}