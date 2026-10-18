import { useEffect, useRef } from 'react'
import { useStore } from '../store'

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
                const o = ((page * 8 + bit) * 128 + x) * 4
                const on = (byte >> bit) & 1
                img.data[o] = on ? 222 : 5
                img.data[o + 1] = on ? 242 : 7
                img.data[o + 2] = on ? 255 : 10
                img.data[o + 3] = 255
              }
            }
          ctx.putImageData(img, 0, 0)
        }
        await new Promise((r) => setTimeout(r, document.hidden ? 2000 : 450))
      }
    }
    void loop()
    return () => {
      alive = false
    }
  }, [connected])

  return (
    <div className="module" title="Live view of the player's screen">
      <div className="glass">
        <canvas ref={canvas} width={128} height={64} hidden={!connected} />
        {!connected && <div className="off">not connected</div>}
      </div>
      <div className="pins">
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  )
}