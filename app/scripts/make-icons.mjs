// Renders resources/icon.svg into build/icon.ico (16-256 px) and build/icon.png + resources/icon.png.
// Run with: node_modules\electron\dist\electron.exe scripts\make-icons.mjs
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'resources', 'icon.svg'), 'utf-8')
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

async function render(size) {
  // offscreen rendering hands us each frame through the 'paint' event
  const win = new BrowserWindow({ show: false, width: size, height: size, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`
  let last = null
  win.webContents.on('paint', (_e, _dirty, image) => (last = image))
  const page = join(tmpdir(), `jjmp3-icon-${size}.html`)
  writeFileSync(page, html)
  await win.loadFile(page)
  for (let i = 0; i < 40 && !last; i++) await new Promise((r) => setTimeout(r, 50))
  await new Promise((r) => setTimeout(r, 200))
  win.destroy()
  if (!last) throw new Error('no frame for ' + size)
  const s = last.getSize()
  return (s.width === size ? last : last.resize({ width: size, height: size, quality: 'best' })).toPNG()
}
/** ICO with PNG-compressed entries (supported since Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, e)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...pngs.map((p) => p.data)])
}

app.whenReady().then(async () => {
  const pngs = []
  // one large render, scaled down for every size
  const big = await render(512)
  const { nativeImage } = await import('electron')
  const source = nativeImage.createFromBuffer(big)
  for (const size of SIZES) pngs.push({ size, data: source.resize({ width: size, height: size, quality: 'best' }).toPNG() })
  writeFileSync(join(root, 'build', 'icon.ico'), ico(pngs))
  writeFileSync(join(root, 'build', 'icon.png'), big)
  writeFileSync(join(root, 'resources', 'icon.png'), big)
  console.log('icons written:', SIZES.join(', '), '+ 512')
  app.quit()
})