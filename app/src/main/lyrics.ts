// Synced lyrics from lrclib.net (free, no account). Cached per song in %APPDATA%\JJMP3\lyrics.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Track } from '@shared/types'
import { DATA_DIR } from './paths'
import { log } from './log'

const DIR = join(DATA_DIR, 'lyrics')
mkdirSync(DIR, { recursive: true })

export interface LyricLine {
  t: number // seconds
  text: string
}
export interface Lyrics {
  found: boolean
  synced: boolean
  lines: LyricLine[]
  plain: string | null
  source?: string
  checked: number
}

const UA = { 'User-Agent': 'JJMP3 (https://github.com/ninjahisser/JJMP3)' }

export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
    if (!stamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text })
  }
  return out.sort((a, b) => a.t - b.t)
}

async function lrclib(path: string): Promise<any> {
  const r = await fetch(`https://lrclib.net/api/${path}`, { headers: UA, signal: AbortSignal.timeout(12000) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`lyrics service answered ${r.status}`)
  return r.json()
}

const clean = (s: string) => s.replace(/\s*[([][^)\]]*(official|video|audio|lyrics?|remaster(ed)?)[^)\]]*[)\]]/gi, '').trim()

export async function getLyrics(t: Pick<Track, 'id' | 'title' | 'artist' | 'duration'>, force = false): Promise<Lyrics> {
  const file = join(DIR, `${t.id}.json`)
  if (!force && existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, 'utf-8')) as Lyrics
      // a miss is retried after a week, a hit is kept
      if (cached.found || Date.now() - cached.checked < 7 * 86400e3) return cached
    } catch {
      // fall through and fetch again
    }
  }
  const title = clean(t.title)
  const artist = t.artist.split(',')[0].trim()
  let hit: any = null
  try {
    const q = new URLSearchParams({ track_name: title, artist_name: artist, duration: String(Math.round(t.duration || 0)) })
    hit = await lrclib(`get?${q}`)
    if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
      const results: any[] = (await lrclib(`search?${new URLSearchParams({ q: `${artist} ${title}`.trim() })}`)) || []
      hit = results.find((r) => r.syncedLyrics && Math.abs((r.duration || 0) - (t.duration || 0)) < 8) || results.find((r) => r.syncedLyrics) || results[0] || null
    }
  } catch (e) {
    log('lyrics lookup failed:', e)
    return { found: false, synced: false, lines: [], plain: null, checked: 0 } // network trouble: don't cache
  }
  const result = toLyrics(hit)
  writeFileSync(file, JSON.stringify(result))
  return result
}

function toLyrics(hit: any): Lyrics {
  const synced = hit?.syncedLyrics ? parseLrc(hit.syncedLyrics) : []
  return {
    found: !!(synced.length || hit?.plainLyrics),
    synced: synced.length > 0,
    lines: synced,
    plain: hit?.plainLyrics || null,
    source: 'lrclib.net',
    checked: Date.now()
  }
}

export interface LyricsHit {
  lrclibId: number
  title: string
  artist: string
  album: string
  duration: number
  synced: boolean
}

/** Free-text search on lrclib, for when a song's own title doesn't match anything. */
export async function searchLyrics(query: string): Promise<LyricsHit[]> {
  const q = query.trim()
  if (!q) return []
  const results: any[] = (await lrclib(`search?${new URLSearchParams({ q })}`)) || []
  return results
    .filter((r) => r.syncedLyrics || r.plainLyrics)
    .slice(0, 30)
    .map((r) => ({ lrclibId: r.id, title: r.trackName || '', artist: r.artistName || '', album: r.albumName || '', duration: r.duration || 0, synced: !!r.syncedLyrics }))
}

/** Use a chosen lrclib entry for this song (kept for good). */
export async function pickLyrics(trackId: string, lrclibId: number): Promise<Lyrics> {
  const hit = await lrclib(`get/${Math.floor(lrclibId)}`)
  if (!hit) throw new Error('That lyrics entry is gone')
  const result = toLyrics(hit)
  writeFileSync(join(DIR, `${trackId}.json`), JSON.stringify(result))
  return result
}
