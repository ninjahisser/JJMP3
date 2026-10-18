// Cover art: a 600px square for the app and a 64x64 1-bit dithered version for the OLED.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ART_DIR, COVER_DIR } from './paths'
import { run, tools } from './tools'

const SQUARE = "crop='min(iw,ih)':'min(iw,ih)'"

/** 64x64 grey -> Floyd-Steinberg 1-bit, 512 bytes, row-major, MSB first (drawBitmap format). */
export function ditherToOled(grey: Uint8Array): Buffer {
  // auto-contrast: stretch the 2nd..98th percentile to the full range
  const sorted = Float32Array.from(grey).sort()
  const lo = sorted[Math.floor(sorted.length * 0.02)]
  const hi = sorted[Math.floor(sorted.length * 0.98)]
  const span = Math.max(1, hi - lo)
  const px = Float32Array.from(grey, (v) => {
    const n = ((v - lo) / span) * 255
    return Math.min(255, Math.max(0, (n - 128) * 1.2 + 128)) // a little extra contrast
  })
  const out = Buffer.alloc(512)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = y * 64 + x
      const old = px[i]
      const on = old >= 128
      if (on) out[y * 8 + (x >> 3)] |= 0x80 >> (x & 7)
      const e = old - (on ? 255 : 0)
      if (x < 63) px[i + 1] += (e * 7) / 16
      if (y < 63) {
        if (x > 0) px[i + 63] += (e * 3) / 16
        px[i + 64] += (e * 5) / 16
        if (x < 63) px[i + 65] += e / 16
      }
    }
  }
  return out
}

/** Writes covers/<id>.jpg and art/<id>.bin from any image ffmpeg can read. */
export async function saveArtwork(id: string, imagePath: string): Promise<void> {
  if (!tools.ffmpeg) throw new Error('ffmpeg missing')
  const cover = await run(tools.ffmpeg, ['-y', '-loglevel', 'error', '-i', imagePath, '-vf', `${SQUARE},scale=600:600:flags=lanczos`, '-q:v', '3', join(COVER_DIR, `${id}.jpg`)])
  if (cover.code) throw new Error('cover conversion failed: ' + cover.stderr.trim())
  const grey = await run(tools.ffmpeg, ['-loglevel', 'error', '-i', imagePath, '-vf', `${SQUARE},scale=64:64:flags=lanczos,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { binary: true })
  if (grey.code || grey.out.length < 4096) throw new Error('art conversion failed: ' + grey.stderr.trim())
  writeFileSync(join(ART_DIR, `${id}.bin`), ditherToOled(grey.out.subarray(0, 4096)))
}