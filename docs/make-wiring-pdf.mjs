// Renders docs/bedrading.html to docs/bedrading.pdf (A4 landscape) with Electron.
// Run: app\node_modules\electron\dist\electron.exe docs\make-wiring-pdf.mjs
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900 })
  await win.loadFile(join(here, 'bedrading.html'))
  await new Promise((r) => setTimeout(r, 400))
  const pdf = await win.webContents.printToPDF({ landscape: true, pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
  writeFileSync(join(here, 'bedrading.pdf'), pdf)
  console.log('bedrading.pdf', pdf.length)
  app.quit()
})
