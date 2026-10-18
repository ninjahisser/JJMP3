// Turns YouTube / Spotify links into player-ready tracks.
// YouTube: audio comes from yt-dlp. Spotify: metadata and artwork come from Spotify's public
// embed pages and the audio is matched on YouTube (search + closest duration).
// Everything becomes 44.1 kHz stereo 128 kbps CBR MP3, the only format the player decodes.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Job } from '@shared/types'
import { saveArtwork } from './artwork'
import { Library } from './library'
import { log } from './log'
import { MEDIA_DIR, TMP_DIR } from './paths'
import { ensureTools, jsRuntime, run, tools } from './tools'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'
const SPOTIFY_RE = /open\.spotify\.com\/(?:intl-[\w-]+\/)?(?:embed\/)?(track|album|playlist)\/([A-Za-z0-9]+)/
const NOISE_RE = /\s*[([][^)\]]*(official|video|audio|lyrics?|visuali[sz]er|hd|4k|remaster(ed)?|mv|m\/v)[^)\]]*[)\]]/gi

interface Item {
  key: string
  title: string
  artist: string
  duration: number
  source: 'youtube' | 'spotify'
  url: string
  cover?: string | null
  spotifyTrack?: string | null
}

export const trackId = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 10)

export function cleanTitle(title = '', uploader = ''): [string, string] {
  let t = title.replace(NOISE_RE, '').trim()
  let artist = uploader.replace(/\s*-\s*Topic$|VEVO$/, '').trim()
  const m = t.match(/^(.+?)\s+[-\u2013\u2014]\s+(.+)$/)
  if (m) [artist, t] = [m[1].trim(), m[2].trim()]
  return [artist, t]
}

async function spotifyEntity(kind: string, id: string): Promise<any> {
  const html = await (await fetch(`https://open.spotify.com/embed/${kind}/${id}`, { headers: { 'User-Agent': UA } })).text()
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error('Could not read that Spotify link')
  return JSON.parse(m[1]).props.pageProps.state.data.entity
}

function bestImage(entity: any): string | null {
  const imgs: any[] = entity?.visualIdentity?.image || entity?.coverArt?.sources || []
  imgs.sort((a, b) => (b.maxWidth || b.width || 0) - (a.maxWidth || a.width || 0))
  return imgs[0]?.url || null
}

async function ytdlpJson(args: string[]): Promise<any> {
  const js = jsRuntime()
  const r = await run(tools.ytdlp!, ['--js-runtimes', js.arg, '--no-warnings', '-J', ...args], { env: js.env })
  if (r.code) throw new Error(r.stderr.trim().split('\n').pop() || 'yt-dlp failed')
  return JSON.parse(r.stdout)
}

/** -> [collection name or null, items], one item per song. */
export async function resolve(url: string): Promise<[string | null, Item[]]> {
  const sp = url.match(SPOTIFY_RE)
  if (sp) {
    const [, kind, id] = sp
    const ent = await spotifyEntity(kind, id)
    if (kind === 'track') {
      const artist = (ent.artists || []).map((a: any) => a.name).join(', ')
      return [null, [{ key: `sp:${id}`, title: ent.title, artist, duration: (ent.duration || 0) / 1000, cover: bestImage(ent), source: 'spotify', url: `https://open.spotify.com/track/${id}` }]]
    }
    const cover = kind === 'album' ? bestImage(ent) : null
    const items: Item[] = (ent.trackList || []).map((t: any) => {
      const tid = String(t.uri).split(':').pop()!
      return { key: `sp:${tid}`, title: t.title, artist: t.subtitle || '', duration: (t.duration || 0) / 1000, cover, spotifyTrack: cover ? null : tid, source: 'spotify', url: `https://open.spotify.com/track/${tid}` }
    })
    return [ent.title || ent.name || null, items]
  }

  const info = await ytdlpJson(['--flat-playlist', url])
  if (info._type === 'playlist') {
    const items: Item[] = (info.entries || [])
      .filter((e: any) => e?.id)
      .map((e: any) => {
        const [artist, title] = cleanTitle(e.title, e.uploader || e.channel)
        return { key: `yt:${e.id}`, title, artist, duration: e.duration || 0, source: 'youtube', url: e.url || `https://www.youtube.com/watch?v=${e.id}` }
      })
    return [info.title || null, items]
  }
  let [artist, title] = cleanTitle(info.track || info.title, info.artist || info.uploader || info.channel)
  if (info.track && info.artist) [artist, title] = [info.artist, info.track]
  return [null, [{ key: `yt:${info.id}`, title, artist, duration: info.duration || 0, source: 'youtube', url: info.webpage_url || url }]]
}

async function matchOnYouTube(item: Item): Promise<string> {
  const res = await ytdlpJson(['--flat-playlist', `ytsearch6:${item.artist} - ${item.title} audio`])
  const hits: any[] = (res.entries || []).filter((e: any) => e?.id)
  if (!hits.length) throw new Error('No match found on YouTube')
  const close = hits.filter((e) => e.duration && item.duration && Math.abs(e.duration - item.duration) <= 12)
  const best = close.length ? close.sort((a, b) => Math.abs(a.duration - item.duration) - Math.abs(b.duration - item.duration))[0] : hits[0]
  return `https://www.youtube.com/watch?v=${best.id}`
}

async function fetchTo(url: string, dest: string): Promise<void> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`image ${r.status}`)
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
}

const shortError = (e: unknown) => (String((e as Error)?.message || e).replace(/^ERROR:\s*/, '').split('\n')[0] || 'Something went wrong').slice(0, 160)

export class Importer {
  jobs: Job[] = [] // newest first
  onChange: () => void = () => {}
  private queue: { job: Job; item: Item }[] = []
  private working = false

  constructor(private library: Library, private onTrackAdded: (id: string) => void) {}

  snapshot(): Job[] {
    return this.jobs.slice(0, 40)
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => !['done', 'error', 'skipped'].includes(j.state))
    this.onChange()
  }

  private job(fields: Partial<Job> & Pick<Job, 'url' | 'title' | 'state'>): Job {
    const j: Job = { id: randomUUID().slice(0, 8), progress: 0, created: Date.now(), ...fields }
    this.jobs.unshift(j)
    this.onChange()
    return j
  }

  submit(url: string, playlistId?: string | null): Job {
    const job = this.job({ url, title: url, state: 'resolving' })
    void this.resolveJob(job, playlistId ?? null)
    return job
  }

  private async resolveJob(job: Job, playlistId: string | null): Promise<void> {
    let name: string | null
    let items: Item[]
    try {
      await ensureTools()
      if (!tools.ytdlp || !tools.ffmpeg) throw new Error('yt-dlp or ffmpeg is missing')
      ;[name, items] = await resolve(job.url)
    } catch (e) {
      Object.assign(job, { state: 'error', error: shortError(e) })
      return this.onChange()
    }
    if (!items.length) {
      Object.assign(job, { state: 'error', error: 'Nothing to import from that link' })
      return this.onChange()
    }
    this.jobs = this.jobs.filter((j) => j !== job)
    if (name && !playlistId && items.length > 1) playlistId = this.library.createPlaylist(name).id
    const ids: string[] = []
    for (const item of items) {
      const id = trackId(item.key)
      ids.push(id)
      if (this.library.has(id)) {
        this.job({ url: item.url, title: item.title, artist: item.artist, state: 'skipped', error: 'Already in your library', trackId: id })
        continue
      }
      this.queue.push({ job: this.job({ url: item.url, title: item.title, artist: item.artist, state: 'queued', trackId: id }), item })
    }
    if (playlistId) {
      const p = this.library.playlist(playlistId)
      if (p) this.library.updatePlaylist(playlistId, { tracks: [...p.tracks, ...ids.filter((i) => !p.tracks.includes(i))] })
    }
    void this.work()
  }

  private async work(): Promise<void> {
    if (this.working) return
    this.working = true
    while (this.queue.length) {
      const { job, item } = this.queue.shift()!
      try {
        await this.process(job, item)
        Object.assign(job, { state: 'done', progress: 1 })
      } catch (e) {
        log('import failed:', job.url, e)
        Object.assign(job, { state: 'error', error: shortError(e) })
      }
      this.onChange()
    }
    this.working = false
  }

  private async process(job: Job, item: Item): Promise<void> {
    const id = job.trackId!
    const tmp = join(TMP_DIR, id)
    rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    const set = (fields: Partial<Job>) => {
      Object.assign(job, fields)
      this.onChange()
    }
    try {
      let src = item.url
      if (item.source === 'spotify') {
        set({ state: 'matching' })
        src = await matchOnYouTube(item)
      }

      set({ state: 'downloading', progress: 0 })
      const js = jsRuntime()
      let lastPush = 0
      const dl = await run(tools.ytdlp!, [
        '--js-runtimes', js.arg, '--no-warnings', '--no-playlist', '--newline', '--write-info-json',
        '-f', 'bestaudio/best', '-o', join(tmp, 'src.%(ext)s'),
        '--progress-template', 'download:JJ %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
        src
      ], {
        env: js.env,
        onLine: (line) => {
          const m = line.match(/^JJ (\d+) (\S+) (\S+)/)
          if (!m) return
          const total = Number(m[2]) || Number(m[3]) || 0
          if (total) job.progress = (Number(m[1]) / total) * 0.8
          if (Date.now() - lastPush > 300) {
            lastPush = Date.now()
            this.onChange()
          }
        }
      })
      if (dl.code) throw new Error(dl.stderr.trim().split('\n').pop() || 'download failed')
      const files = readdirSync(tmp)
      const audio = files.find((f) => f.startsWith('src.') && !f.endsWith('.json') && !f.endsWith('.part'))
      if (!audio) throw new Error('download produced no audio')
      const infoFile = files.find((f) => f.endsWith('.info.json'))
      const info = infoFile ? JSON.parse(readFileSync(join(tmp, infoFile), 'utf-8')) : {}

      set({ state: 'converting', progress: 0.85 })
      const out = join(MEDIA_DIR, `${id}.mp3`)
      const conv = await run(tools.ffmpeg!, ['-y', '-loglevel', 'error', '-i', join(tmp, audio), '-vn', '-ac', '2', '-ar', '44100', '-b:a', '128k',
        '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '0', out])
      if (conv.code) throw new Error('conversion failed: ' + conv.stderr.trim().split('\n').pop())
      const duration = Math.round(statSync(out).size / 16000) // CBR 128 kbps, no tags

      set({ state: 'artwork', progress: 0.95 })
      let cover = item.cover || null
      if (!cover && item.spotifyTrack) cover = await spotifyEntity('track', item.spotifyTrack).then(bestImage, () => null)
      cover = cover || info.thumbnail || null
      let hasCover = false
      if (cover) {
        try {
          const img = join(tmp, 'cover.img')
          await fetchTo(cover, img)
          await saveArtwork(id, img)
          hasCover = true
        } catch (e) {
          log('artwork failed:', e)
        }
      }

      this.library.add({
        id, title: item.title || info.title || 'Untitled', artist: item.artist || '', duration,
        source: item.source, url: item.url, cover: hasCover, size: statSync(out).size
      })
      this.onTrackAdded(id)
    } finally {
      if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
    }
  }
}