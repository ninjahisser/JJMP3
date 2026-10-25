import { BrowserWindow, Menu, app, ipcMain, nativeImage, net, protocol, shell } from 'electron'
import { THUMB_ICONS } from './thumbIcons'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EVENT_CHANNEL, type Snapshot } from '@shared/types'
import { Device } from './device'
import { Importer, type Item } from './importer'
import { Library } from './library'
import { log } from './log'
import { ART_DIR, COVER_DIR, DATA_DIR, MEDIA_DIR } from './paths'
import { makeOledArt } from './artwork'
import { Sync } from './sync'
import { getLyrics, pickLyrics, searchLyrics } from './lyrics'
import { SPOTIFY_ART, SpotifyMode } from './spotify'
import { addGame, listGames, removeGame } from './games'
import { detectTools, ensureTools, setToolsListener, tools, updateYtDlpLater } from './tools'

protocol.registerSchemesAsPrivileged([{ scheme: 'jjmp3', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

// Every copy (installed, bin\, dev) must share one lock and one data folder: two instances
// writing library.json at once lose songs. The lock lives in userData, so pin both.
app.setName('Z0Ɛ')
app.setPath('userData', DATA_DIR)
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const library = new Library()
const device = new Device(
  () => library.setting<string | null>('wifiHost', null),
  (h) => library.setSetting('wifiHost', h)
)
const sync = new Sync(library, device)
device.onConnect.push(() => {
  const t = Math.floor(Date.now() / 1000)
  void device.call('time_set', { t, tz: -new Date().getTimezoneOffset() }).catch(() => {})
})
const spotify = new SpotifyMode(device)
const importer = new Importer(library, () => sync.kick(true))
let win: BrowserWindow | null = null

function snapshot(): Snapshot {
  const tracks = library.tracks().map((t) => ({ ...t, onDevice: sync.onDevice.has(t.id), uploading: sync.progress.get(t.id) ?? null }))
  return {
    device: device.view(),
    sync: { loaded: sync.loaded, error: sync.error, busy: sync.progress.size > 0 },
    tracks: [...tracks, ...sync.deviceOnly()],
    playlists: library.playlists(),
    jobs: importer.snapshot(),
    tools: { ...tools },
    theme: library.setting<'light' | 'dark'>('theme', 'light'),
    palette: library.setting<'green' | 'paper' | 'slate'>('palette', 'green'),
    spotify: spotify.view
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
library.onChange = device.onChange = sync.onChange = importer.onChange = spotify.onChange = push
setToolsListener(push)

/** Runs a device command; a refusal from the player becomes an error with its message. */
async function deviceCall(cmd: string, params: Record<string, unknown> = {}, timeout = 6000) {
  const r = await device.call(cmd, params, timeout)
  if (r.ok === false) throw new Error(r.error || 'The player refused that.')
  push()
  return r
}

/** OLED art is 48x48 (it fits the blue area). Redo any older 64x64 art from the saved cover. */
async function migrateArt(): Promise<void> {
  const stale = library.tracks().filter((t) => existsSync(join(ART_DIR, `${t.id}.bin`)) && statSync(join(ART_DIR, `${t.id}.bin`)).size !== 288)
  if (!stale.length) return
  await ensureTools()
  if (!tools.ffmpeg) return
  const redone: string[] = []
  for (const t of stale) {
    const cover = join(COVER_DIR, `${t.id}.jpg`)
    if (!existsSync(cover)) continue
    try {
      await makeOledArt(t.id, cover)
      redone.push(t.id)
    } catch (e) {
      log('art migration failed for', t.id, e)
    }
  }
  library.setSetting('artPending', [...new Set([...library.setting<string[]>('artPending', []), ...redone])])
  library.setSetting('artVersion', 2)
  log('art migrated to 48x48:', redone.length)
  sync.kick()
}

/** Songs whose files exist but that the library lost track of come back, named from the player's index when possible. */
function recoverOrphans(): void {
  let n = 0
  for (const f of readdirSync(MEDIA_DIR)) {
    const id = f.replace(/\.mp3$/, '')
    if (!f.endsWith('.mp3') || !/^[a-f0-9]{10}$/.test(id) || library.has(id)) continue
    const meta = sync.onDevice.get(id)
    library.add({
      id,
      title: meta?.title || 'Untitled',
      artist: meta?.artist || '',
      duration: meta?.duration || Math.round(statSync(join(MEDIA_DIR, f)).size / 16000),
      cover: existsSync(join(COVER_DIR, `${id}.jpg`)),
      recovered: true,
      added: statSync(join(MEDIA_DIR, f)).mtimeMs / 1000
    })
    n++
  }
  // fill in names for earlier recoveries once the player's index is known
  for (const t of library.tracks()) {
    const meta = sync.onDevice.get(t.id)
    if (t.recovered && t.title === 'Untitled' && meta) library.update(t.id, { title: meta.title, artist: meta.artist, duration: meta.duration })
  }
  if (n) log('recovered', n, 'songs from files on disk')
}

const CONTROLS = new Set(['toggle', 'play', 'pause', 'next', 'prev', 'seek', 'vol', 'mode'])

function registerIpc(): void {
  const h = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, (_e, ...args) => fn(...args))

  h('state', () => snapshot())
  h('theme:set', (theme: 'light' | 'dark') => {
    library.setSetting('theme', theme === 'dark' ? 'dark' : 'light')
    paintWindow()
  })
  h('lyrics:get', (id: string) => {
    const t = library.get(id)
    if (!t) throw new Error('No such song')
    return getLyrics(t).then((l) => ({ ...l, offset: library.setting<Record<string, number>>('lyricsOffsets', {})[id] ?? 0 }))
  })
  h('lyrics:search', (query: string) => searchLyrics(String(query)))
  h('lyrics:pick', async (id: string, lrclibId: number) => ({ ...(await pickLyrics(id, lrclibId)), offset: library.setting<Record<string, number>>('lyricsOffsets', {})[id] ?? 0 }))
  h('lyrics:offset', (id: string, seconds: number) => {
    const all = { ...library.setting<Record<string, number>>('lyricsOffsets', {}) }
    const v = Math.max(-30, Math.min(30, Math.round(Number(seconds) * 10) / 10))
    if (v === 0) delete all[id]
    else all[id] = v
    library.setSetting('lyricsOffsets', all)
    return v
  })
  h('spotify:set', (on: boolean) => {
    library.setSetting('spotifyMode', !!on)
    if (on) spotify.start()
    else spotify.stop()
  })
  h('spotify:control', (cmd: string) => spotify.control(cmd))
  h('media:state', (playing: boolean) => setThumbButtons(!!playing))
  h('palette:set', (palette: string) => {
    library.setSetting('palette', ['green', 'paper', 'slate'].includes(palette) ? palette : 'green')
    paintWindow()
  })

  h('import', (url: string, playlistId?: string) => {
    url = String(url || '').trim()
    if (!/^https?:\/\//.test(url)) throw new Error('Paste a full YouTube or Spotify link.')
    return importer.submit(url, playlistId)
  })
  h('preview', (url: string) => {
    url = String(url || '').trim()
    if (!url) throw new Error('Type a song name or paste a link.')
    return importer.preview(url)
  })
  h('import:items', (items: Item[], name: string | null) => importer.addItems(items, name))
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

  h('play', async ({ trackId, playlistId, shuffle, queue }: { trackId?: string; playlistId?: string; shuffle?: boolean; queue?: string[] }) => {
    let ids = queue ?? (playlistId ? library.playlist(playlistId)?.tracks ?? [] : [...library.tracks(), ...sync.deviceOnly()].map((t) => t.id))
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
    const r = await device.poll('screen')
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
  h('user:set', (name: string) => deviceCall('user_set', { name: String(name || '').slice(0, 20) }))
  h('btn', (k: string, hold = false) => {
    if (!['left', 'play', 'right', 'up', 'down'].includes(k)) throw new Error('Unknown button')
    return device.tryCall('btn', { k, hold })
  })
  h('games:list', () => listGames(device))
  h('games:add', (name: string, data: Uint8Array) => addGame(device, name, data))
  h('games:remove', (name: string) => removeGame(device, name))
  h('reboot', () => deviceCall('reboot'))
  h('sd', () => deviceCall('sd', {}, 20000))

  h('open:url', (url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}

// Window and title-bar colours; they must match the --paper / --ink variables in styles.css
const THEME: Record<string, { bg: string; fg: string }> = {
  'green-light': { bg: '#eef2ea', fg: '#1d2a21' },
  'green-dark': { bg: '#161d18', fg: '#e6eee8' },
  'paper-light': { bg: '#f1ede4', fg: '#1b1a17' },
  'paper-dark': { bg: '#1c1b18', fg: '#ede7db' },
  'slate-light': { bg: '#edf0f4', fg: '#1c2430' },
  'slate-dark': { bg: '#171b22', fg: '#e5e9f0' }
}
const themeColors = () =>
  THEME[`${library.setting<string>('palette', 'green')}-${library.setting<string>('theme', 'light')}`] ?? THEME['green-light']

/** Window background and the title-bar buttons follow the theme. */
function paintWindow(): void {
  if (!win) return
  const c = themeColors()
  win.setBackgroundColor(c.bg)
  win.setTitleBarOverlay({ color: c.bg, symbolColor: c.fg, height: 40 })
}

let thumbPlaying = false
/** Previous / play-pause / next on the taskbar thumbnail, like Spotify. They act on whatever is playing (player or computer). */
function setThumbButtons(playing = thumbPlaying): void {
  thumbPlaying = playing
  if (!win || win.isDestroyed()) return
  const send = (action: string) => () => win?.webContents.send(EVENT_CHANNEL, 'media', action)
  win.setThumbarButtons([
    { tooltip: 'Previous', icon: nativeImage.createFromDataURL(THUMB_ICONS.prev), click: send('prev') },
    { tooltip: playing ? 'Pause' : 'Play', icon: nativeImage.createFromDataURL(playing ? THUMB_ICONS.pause : THUMB_ICONS.play), click: send('toggle') },
    { tooltip: 'Next', icon: nativeImage.createFromDataURL(THUMB_ICONS.next), click: send('next') }
  ])
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
    backgroundColor: themeColors().bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: themeColors().bg, symbolColor: themeColors().fg, height: 40 },
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.mjs'), sandbox: false, backgroundThrottling: process.env.JJMP3_DEV !== '1' }
  })
  win.once('ready-to-show', () => {
    win?.show()
    setThumbButtons(false)
  })
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
  // jjmp3://cover/<id> artwork, jjmp3://media/<id> audio (with byte ranges, so seeking works)
  protocol.handle('jjmp3', (req) => {
    const { host, pathname } = new URL(req.url)
    const id = pathname.replace(/^\//, '')
    if (host === 'spotify') {
      if (!existsSync(SPOTIFY_ART)) return new Response('none', { status: 404 })
      const bytes = readFileSync(SPOTIFY_ART)
      return new Response(bytes, { headers: { 'Content-Type': bytes[0] === 0x89 ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' } })
    }
    if (!/^[a-f0-9]{6,40}$/.test(id)) return new Response('not found', { status: 404 })
    if (host === 'cover') {
      const file = join(COVER_DIR, `${id}.jpg`)
      return existsSync(file) ? net.fetch(pathToFileURL(file).toString()) : new Response('not found', { status: 404 })
    }
    if (host === 'media') {
      const file = join(MEDIA_DIR, `${id}.mp3`)
      if (!existsSync(file)) return new Response('not found', { status: 404 })
      const size = statSync(file).size
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '')
      const start = m && m[1] ? Number(m[1]) : 0
      const end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
      const headers = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), ...(m && { 'Content-Range': `bytes ${start}-${end}/${size}` }) }
      return new Response(body, { status: m ? 206 : 200, headers })
    }
    return new Response('not found', { status: 404 })
  })
  registerIpc()
  createWindow()
  detectTools()
  updateYtDlpLater()
  ensureTools().catch((e) => log('tool setup failed:', e))
  recoverOrphans()
  if (library.setting('spotifyMode', false)) spotify.start()
  sync.onLoaded = recoverOrphans
  migrateArt().catch((e) => log('art migration failed:', e))
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