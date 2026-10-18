import { BrowserWindow, Menu, app, ipcMain, net, protocol, shell } from 'electron'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EVENT_CHANNEL, type Snapshot } from '@shared/types'
import { Device } from './device'
import { Importer } from './importer'
import { Library } from './library'
import { log } from './log'
import { COVER_DIR } from './paths'
import { Sync } from './sync'
import { detectTools, ensureTools, setToolsListener, tools, updateYtDlpLater } from './tools'

protocol.registerSchemesAsPrivileged([{ scheme: 'jjmp3', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

if (!app.requestSingleInstanceLock()) app.quit()

const library = new Library()
const device = new Device(
  () => library.setting<string | null>('wifiHost', null),
  (h) => library.setSetting('wifiHost', h)
)
const sync = new Sync(library, device)
const importer = new Importer(library, () => sync.kick())
let win: BrowserWindow | null = null

function snapshot(): Snapshot {
  const tracks = library.tracks().map((t) => ({ ...t, onDevice: sync.onDevice.has(t.id), uploading: sync.progress.get(t.id) ?? null }))
  return {
    device: device.view(),
    sync: { loaded: sync.loaded, error: sync.error, busy: sync.progress.size > 0 },
    tracks: [...tracks, ...sync.deviceOnly()],
    playlists: library.playlists(),
    jobs: importer.snapshot(),
    tools: { ...tools }
  }
}

// Push state to the window, at most every 120 ms
let pushTimer: NodeJS.Timeout | null = null
function push(): void {
  if (pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    win?.webContents.send(EVENT_CHANNEL, 'state', snapshot())
  }, 120)
}
library.onChange = device.onChange = sync.onChange = importer.onChange = push
setToolsListener(push)

/** Runs a device command; a refusal from the player becomes an error with its message. */
async function deviceCall(cmd: string, params: Record<string, unknown> = {}, timeout = 6000) {
  const r = await device.call(cmd, params, timeout)
  if (r.ok === false) throw new Error(r.error || 'The player refused that.')
  push()
  return r
}

const CONTROLS = new Set(['toggle', 'play', 'pause', 'next', 'prev', 'seek', 'vol', 'mode'])

function registerIpc(): void {
  const h = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, (_e, ...args) => fn(...args))

  h('state', () => snapshot())

  h('import', (url: string, playlistId?: string) => {
    url = String(url || '').trim()
    if (!/^https?:\/\//.test(url)) throw new Error('Paste a full YouTube or Spotify link.')
    return importer.submit(url, playlistId)
  })
  h('jobs:clear', () => importer.clearFinished())
  h('tools:install', () => ensureTools())

  h('track:edit', (id: string, fields: { title?: string; artist?: string }) => {
    const t = library.update(id, {
      ...(fields.title !== undefined && { title: fields.title.trim() }),
      ...(fields.artist !== undefined && { artist: fields.artist.trim() })
    })
    sync.kick(true)
    return t
  })
  h('track:remove', (id: string) => {
    library.drop(id)
    sync.forget(id)
  })

  h('playlist:create', (name: string, tracks: string[] = []) => library.createPlaylist(name, tracks))
  h('playlist:update', (id: string, fields: { name?: string; tracks?: string[] }) => library.updatePlaylist(id, fields))
  h('playlist:remove', (id: string) => library.deletePlaylist(id))

  h('play', async ({ trackId, playlistId, shuffle }: { trackId?: string; playlistId?: string; shuffle?: boolean }) => {
    let ids = playlistId ? library.playlist(playlistId)?.tracks ?? [] : [...library.tracks(), ...sync.deviceOnly()].map((t) => t.id)
    ids = ids.filter((id) => sync.onDevice.has(id))
    if (!ids.length) throw new Error('Nothing on the player yet. Wait for the upload to finish.')
    if (shuffle !== undefined) await deviceCall('mode', { shuffle })
    return deviceCall('play', { queue: ids, index: Math.max(0, ids.indexOf(trackId ?? '')) })
  })
  h('control', (cmd: string, params: Record<string, unknown> = {}) => {
    if (!CONTROLS.has(cmd)) throw new Error('Unknown control')
    return deviceCall(cmd, params)
  })
  h('screen', async () => {
    const r = await device.tryCall('screen')
    if (!r?.b64) return null
    const buf = Buffer.from(r.b64, 'base64')
    return buf.length === 1024 ? new Uint8Array(buf) : null
  })

  h('wifi:scan', () => deviceCall('wifi_scan', {}, 15000))
  h('wifi:set', (ssid: string, pass: string) => deviceCall('wifi_set', { ssid, pass }))
  h('wifi:forget', () => {
    library.setSetting('wifiHost', null)
    return deviceCall('wifi_forget')
  })
  h('bt:scan', () => deviceCall('bt_scan'))
  h('bt:stop', () => deviceCall('bt_stop'))
  h('bt:devices', () => deviceCall('bt_devices'))
  h('bt:connect', (name: string) => deviceCall('bt_connect', { name }))
  h('bt:forget', () => deviceCall('bt_forget'))
  h('mode:switch', () => deviceCall('mode_switch'))
  h('reboot', () => deviceCall('reboot'))
  h('sd', () => deviceCall('sd', {}, 20000))

  h('open:url', (url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(process.env.JJMP3_DEV === '1' && { x: -2600, y: 40 }), // testing: render off-screen
    title: 'JJMP3',
    backgroundColor: '#f1ede4',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f1ede4', symbolColor: '#1b1a17', height: 40 },
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false, backgroundThrottling: process.env.JJMP3_DEV !== '1' }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  protocol.handle('jjmp3', (req) => {
    const { host, pathname } = new URL(req.url)
    const id = pathname.replace(/^\//, '')
    const file = host === 'cover' && /^[a-f0-9]{6,40}$/.test(id) ? join(COVER_DIR, `${id}.jpg`) : ''
    if (!file || !existsSync(file)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
  registerIpc()
  createWindow()
  detectTools()
  updateYtDlpLater()
  ensureTools().catch((e) => log('tool setup failed:', e))
  log('JJMP3 started', app.getVersion())
})

/** JJMP3_DEV=1 (testing only): GET /shot?page=library returns a PNG of the window; POST /eval runs JS in the window. */
function devServer(): void {
  if (process.env.JJMP3_DEV !== '1') return
  createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x')
    if (win && url.pathname === '/eval' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      const out = await win.webContents.executeJavaScript(body).then((v) => JSON.stringify(v ?? null), (e) => JSON.stringify({ error: String(e) }))
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(out)
    }
    if (!win || url.pathname !== '/shot') return res.writeHead(404).end()
    const page = url.searchParams.get('page')
    if (page) win.webContents.send(EVENT_CHANNEL, 'dev:go', page.includes(':') ? { name: 'playlist', id: page.split(':')[1] } : { name: page })
    await new Promise((r) => setTimeout(r, Number(url.searchParams.get('wait') || 900)))
    const img = await win.webContents.capturePage()
    res.writeHead(200, { 'Content-Type': 'image/png' }).end(img.toPNG())
  }).listen(47920, '127.0.0.1')
}

app.whenReady().then(devServer)

app.on('window-all-closed', () => app.quit())