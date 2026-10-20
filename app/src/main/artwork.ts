// Cover art: a 600px square for the app and a 48x48 1-bit dithered version for the OLED's blue area.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ART_DIR, COVER_DIR } from './paths'
import { run, tools } from './tools'

const SQUARE = "crop='min(iw,ih)':'min(iw,ih)'"

export const ART_SIZE = 48

/** size x size grey -> Floyd-Steinberg 1-bit, row-major, MSB first (drawBitmap format). 48x48 = 288 bytes. */
export function ditherToOled(grey: Uint8Array, size = ART_SIZE): Buffer {
  const S = size
  const rowBytes = S / 8
  // auto-contrast: stretch the 2nd..98th percentile to the full range
  const sorted = Float32Array.from(grey).sort()
  const lo = sorted[Math.floor(sorted.length * 0.02)]
  const hi = sorted[Math.floor(sorted.length * 0.98)]
  const span = Math.max(1, hi - lo)
  const px = Float32Array.from(grey, (v) => {
    const n = ((v - lo) / span) * 255
    return Math.min(255, Math.max(0, (n - 128) * 1.2 + 128)) // a little extra contrast
  })
  const out = Buffer.alloc(rowBytes * S)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x
      const old = px[i]
      const on = old >= 128
      if (on) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7)
      const e = old - (on ? 255 : 0)
      if (x < S - 1) px[i + 1] += (e * 7) / 16
      if (y < S - 1) {
        if (x > 0) px[i + S - 1] += (e * 3) / 16
        px[i + S] += (e * 5) / 16
        if (x < S - 1) px[i + S + 1] += e / 16
      }
    }
  }
  return out
}

/** Dithered 1-bit picture of any square size, from any image ffmpeg can read. */
export async function oledPicture(imagePath: string, size = ART_SIZE): Promise<Buffer> {
  if (!tools.ffmpeg) throw new Error('ffmpeg missing')
  const n = size * size
  const grey = await run(tools.ffmpeg, ['-loglevel', 'error', '-i', imagePath, '-vf', `${SQUARE},scale=${size}:${size}:flags=lanczos,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { binary: true })
  if (grey.code || grey.out.length < n) throw new Error('picture conversion failed: ' + grey.stderr.trim())
  return ditherToOled(grey.out.subarray(0, n), size)
}

/** Writes art/<id>.bin, the player's dithered artwork, from any image ffmpeg can read. */
export async function makeOledArt(id: string, imagePath: string): Promise<void> {
  if (!tools.ffmpeg) throw new Error('ffmpeg missing')
  const n = ART_SIZE * ART_SIZE
  const grey = await run(tools.ffmpeg, ['-loglevel', 'error', '-i', imagePath, '-vf', `${SQUARE},scale=${ART_SIZE}:${ART_SIZE}:flags=lanczos,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { binary: true })
  if (grey.code || grey.out.length < n) throw new Error('art conversion failed: ' + grey.stderr.trim())
  writeFileSync(join(ART_DIR, `${id}.bin`), ditherToOled(grey.out.subarray(0, n)))
}

/** Writes covers/<id>.jpg and art/<id>.bin from any image ffmpeg can read. */
export async function saveArtwork(id: string, imagePath: string): Promise<void> {
  if (!tools.ffmpeg) throw new Error('ffmpeg missing')
  const cover = await run(tools.ffmpeg, ['-y', '-loglevel', 'error', '-i', imagePath, '-vf', `${SQUARE},scale=600:600:flags=lanczos`, '-q:v', '3', join(COVER_DIR, `${id}.jpg`)])
  if (cover.code) throw new Error('cover conversion failed: ' + cover.stderr.trim())
  await makeOledArt(id, imagePath)
}