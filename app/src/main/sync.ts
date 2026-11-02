// Keeps the player's SD card in step with the local library.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Track } from '@shared/types'
import { Device, LinkError } from './device'
import { Library, deviceText } from './library'
import { ART_DIR, MEDIA_DIR } from './paths'
import { log } from './log'

interface IndexEntry {
  id: string
  title: string
  artist: string
  duration: number
}

export function parseIndex(text: string): Map<string, IndexEntry> {
  const out = new Map<string, IndexEntry>()
  for (const line of text.split('\n')) {
    const [id, title = '', artist = '', dur = '0'] = line.split('\t')
    if (id && line.includes('\t')) out.set(id, { id, title, artist, duration: parseInt(dur) || 0 })
  }
  return out
}

export class Sync {
  onDevice = new Map<string, IndexEntry>() // as last read from / written to the card
  loaded = false
  progress = new Map<string, number>() // id -> 0..1 while uploading
  error = ''
  onChange: () => void = () => {}
  onLoaded: () => void = () => {}
  private removals = new Set<string>()
  private indexDirty = false
  private playlistsOnCard = ''
  private running = false
  private again = false

  constructor(private library: Library, private device: Device) {
    device.onConnect.push(() => void this.readCard())
    setInterval(() => this.kick(), 5000)
  }

  /** Tracks on the card that this computer has no copy of. */
  deviceOnly(): Track[] {
    return [...this.onDevice.values()].filter((t) => !this.library.has(t.id)).map((t) => ({ ...t, deviceOnly: true }))
  }

  kick(indexChanged = false): void {
    this.indexDirty ||= indexChanged
    if (this.running) {
      this.again = true
      return
    }
    void this.runOnce()
  }

  forget(id: string): void {
    this.removals.add(id)
    this.kick()
  }

  private async readCard(): Promise<void> {
    let text = ''
    try {
      text = (await this.device.get('/index.tsv')).toString('latin1')
    } catch {
      // empty card
    }
    this.onDevice = parseIndex(text)
    this.playlistsOnCard = ''
    this.loaded = true
    this.onLoaded()
    this.onChange()
    this.kick()
  }

  /** True while something else needs the link to itself (a firmware update), or the player has no working card. */
  paused = !!process.env.JJMP3_NOSYNC

  private async runOnce(): Promise<void> {
    if (this.paused || !this.device.connected || !this.loaded) return
    if (this.device.status.sd === false) return // no card to sync to; sending songs would only clog the link
    this.running = true
    try {
      do {
        this.again = false
        await this.syncNow()
      } while (this.again)
      this.error = ''
    } catch (e) {
      this.error = (e as Error).message
      log('sync failed:', e)
      if (e instanceof LinkError) this.loaded = false
    } finally {
      this.running = false
      this.progress.clear()
      this.onChange()
    }
  }

  private async syncNow(): Promise<void> {
    let changed = this.indexDirty
    this.indexDirty = false

    for (const id of [...this.removals]) {
      for (const path of [`/music/${id}.mp3`, `/art/${id}.bin`]) await this.device.call('rm', { path })
      this.onDevice.delete(id)
      this.removals.delete(id)
      changed = true
    }
    if (changed) await this.writeIndex()

    // artwork redone on this computer (e.g. a new format) goes out to songs already on the card
    const pending = this.library.setting<string[]>('artPending', [])
    for (const id of pending) {
      const art = join(ART_DIR, `${id}.bin`)
      if (this.onDevice.has(id) && existsSync(art)) await this.device.put(`/art/${id}.bin`, readFileSync(art))
      this.library.setSetting('artPending', this.library.setting<string[]>('artPending', []).filter((x) => x !== id))
    }
    for (const t of this.library.tracks()) {
      const mp3 = join(MEDIA_DIR, `${t.id}.mp3`)
      if (this.onDevice.has(t.id) || !existsSync(mp3)) continue
      this.progress.set(t.id, 0)
      this.onChange()
      let lastPush = 0
      await this.device.put(`/music/${t.id}.mp3`, readFileSync(mp3), (done, total) => {
        this.progress.set(t.id, (done / total) * 0.98)
        if (Date.now() - lastPush > 400) {
          lastPush = Date.now()
          this.onChange()
        }
      })
      const art = join(ART_DIR, `${t.id}.bin`)
      if (existsSync(art)) await this.device.put(`/art/${t.id}.bin`, readFileSync(art))
      this.onDevice.set(t.id, { id: t.id, title: deviceText(t.title), artist: deviceText(t.artist), duration: t.duration })
      await this.writeIndex()
      this.progress.delete(t.id)
      this.onChange()
    }
    await this.writePlaylists()
  }

  /** /playlists.tsv: id, name, comma-separated song ids (tab separated; only songs on the card). */
  private async writePlaylists(): Promise<void> {
    const text = this.library
      .playlists()
      .map((p) => [p.id, deviceText(p.name) || 'Playlist', p.tracks.filter((id) => this.onDevice.has(id)).join(',')].join('\t'))
      .join('\n') + '\n'
    if (text === this.playlistsOnCard) return
    await this.device.put('/playlists.tsv', Buffer.from(text, 'latin1'))
    this.playlistsOnCard = text
  }

  private async writeIndex(): Promise<void> {
    const known = this.library.indexTsv(new Set(this.onDevice.keys()))
    const extra = this.deviceOnly()
      .map((t) => `${t.id}\t${t.title}\t${t.artist}\t${t.duration}\n`)
      .join('')
    await this.device.put('/index.tsv', Buffer.from(known + extra, 'latin1'))
    await this.device.call('reload')
  }
}
