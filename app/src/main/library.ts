import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Playlist, Track } from '@shared/types'
import { ART_DIR, COVER_DIR, LIBRARY_FILE, MEDIA_DIR } from './paths'

interface LibraryData {
  tracks: Record<string, Track>
  order: string[]
  playlists: Playlist[]
  settings: Record<string, unknown>
}

/** Plain ASCII for the OLED font: accents folded, no tabs or newlines. */
export function deviceText(s: string): string {
  return (s || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Local music library: track metadata, playlists and settings in one JSON file. */
export class Library {
  private data: LibraryData = { tracks: {}, order: [], playlists: [], settings: {} }
  onChange: () => void = () => {}

  constructor() {
    if (existsSync(LIBRARY_FILE)) Object.assign(this.data, JSON.parse(readFileSync(LIBRARY_FILE, 'utf-8')))
  }

  private save(): void {
    const tmp = LIBRARY_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data, null, 1))
    renameSync(tmp, LIBRARY_FILE)
    this.onChange()
  }

  // ---- tracks ----
  tracks(): Track[] {
    return this.data.order.map((id) => this.data.tracks[id]).filter(Boolean)
  }

  get(id: string): Track | undefined {
    return this.data.tracks[id]
  }

  has(id: string): boolean {
    return id in this.data.tracks
  }

  add(track: Track): void {
    track.added ??= Date.now() / 1000
    this.data.tracks[track.id] = track
    if (!this.data.order.includes(track.id)) this.data.order.unshift(track.id) // newest first
    this.save()
  }

  update(id: string, fields: Partial<Track>): Track | undefined {
    const t = this.data.tracks[id]
    if (!t) return undefined
    Object.assign(t, fields)
    this.save()
    return t
  }

  drop(id: string): void {
    delete this.data.tracks[id]
    this.data.order = this.data.order.filter((x) => x !== id)
    for (const p of this.data.playlists) p.tracks = p.tracks.filter((x) => x !== id)
    this.save()
    for (const f of [join(MEDIA_DIR, `${id}.mp3`), join(COVER_DIR, `${id}.jpg`), join(ART_DIR, `${id}.bin`)]) {
      try {
        unlinkSync(f)
      } catch {
        // already gone
      }
    }
  }

  /** The player's index file for the given tracks, in library order. */
  indexTsv(ids: Set<string>): string {
    const lines = this.tracks()
      .filter((t) => ids.has(t.id))
      .map((t) => [t.id, deviceText(t.title) || 'Untitled', deviceText(t.artist), String(Math.round(t.duration || 0))].join('\t'))
    return lines.join('\n') + '\n'
  }

  // ---- playlists ----
  playlists(): Playlist[] {
    return this.data.playlists
  }

  playlist(id: string): Playlist | undefined {
    return this.data.playlists.find((p) => p.id === id)
  }

  createPlaylist(name: string, tracks: string[] = []): Playlist {
    const p: Playlist = { id: randomUUID().slice(0, 8), name: name.trim() || 'Untitled', tracks: [...tracks], created: Date.now() / 1000 }
    this.data.playlists.push(p)
    this.save()
    return p
  }

  updatePlaylist(id: string, fields: { name?: string; tracks?: string[] }): Playlist | undefined {
    const p = this.playlist(id)
    if (!p) return undefined
    if (fields.name !== undefined) p.name = fields.name.trim() || p.name
    if (fields.tracks !== undefined) p.tracks = fields.tracks.filter((t) => t in this.data.tracks)
    this.save()
    return p
  }

  deletePlaylist(id: string): void {
    this.data.playlists = this.data.playlists.filter((p) => p.id !== id)
    this.save()
  }

  // ---- settings ----
  setting<T>(key: string, fallback: T): T {
    return (this.data.settings[key] as T) ?? fallback
  }

  setSetting(key: string, value: unknown): void {
    this.data.settings[key] = value
    this.save()
  }
}
