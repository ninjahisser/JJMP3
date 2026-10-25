// "Spotify mode": follows whatever the Windows media controls report (Spotify first), lets the app
// control it, and mirrors it on the player's screen. The player's buttons control it back.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SpotifyView } from '@shared/types'
import smtcScript from './smtc.ps1?raw'
import { oledPicture } from './artwork'
import type { Device } from './device'
import { deviceText } from './library'
import { log } from './log'
import { DATA_DIR } from './paths'

export const SPOTIFY_ART = join(DATA_DIR, 'spotify-art.img')
const SCRIPT = join(DATA_DIR, 'smtc.ps1')
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']

const idle: SpotifyView = { on: false, available: false, title: '', artist: '', album: '', app: '', playing: false, pos: 0, dur: 0, art: 0 }

export class SpotifyMode {
  view: SpotifyView = { ...idle }
  onChange: () => void = () => {}
  private proc: ChildProcess | null = null
  private buf = ''
  private pushedKey = ''
  private lastPush = 0
  private timer: NodeJS.Timeout | null = null

  constructor(private device: Device) {
    device.onEvent.push((e) => this.onDeviceKey(e))
    device.onConnect.push(() => {
      this.pushedKey = ''
    })
  }

  get on(): boolean {
    return this.view.on
  }

  start(): void {
    if (this.proc) return
    writeFileSync(SCRIPT, smtcScript)
    this.view = { ...idle, on: true }
    const p = spawn('powershell.exe', [...PS, SCRIPT, '-Mode', 'poll', '-ArtFile', SPOTIFY_ART], { windowsHide: true })
    this.proc = p
    p.stdout.on('data', (d: Buffer) => this.read(d.toString()))
    p.stderr.on('data', (d: Buffer) => log('spotify mode:', d.toString().trim()))
    p.on('exit', () => {
      if (this.proc === p) this.proc = null
    })
    this.timer = setInterval(() => void this.mirror(), 1000)
    this.onChange()
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.view.on) void this.device.tryCall('remote', { on: false })
    this.view = { ...idle }
    this.pushedKey = ''
    this.onChange()
  }

  private read(text: string): void {
    this.buf += text
    const lines = this.buf.split(/\r?\n/)
    this.buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('{')) continue
      try {
        const j = JSON.parse(line)
        this.view = {
          on: true,
          available: !!j.available,
          title: j.title || '',
          artist: j.artist || '',
          album: j.album || '',
          app: String(j.app || '').replace(/\.exe$/i, '').replace(/^.*!/, '').replace(/^[0-9A-F]{10,}$/i, ''), // browsers report a hash, not a name
          playing: !!j.playing,
          pos: Number(j.pos) || 0,
          dur: Number(j.dur) || 0,
          art: Number(j.art) || 0
        }
        this.onChange()
      } catch {
        // partial line, ignore
      }
    }
  }

  /** Send a control to the media session (a short PowerShell run each time). */
  control(cmd: string): void {
    if (!/^(toggle|play|pause|next|prev|seek:\d+(\.\d+)?)$/.test(cmd)) return
    writeFileSync(SCRIPT, smtcScript)
    spawn('powershell.exe', [...PS, SCRIPT, '-Mode', 'cmd', '-Cmd', cmd], { windowsHide: true }).on('error', (e) => log('spotify control failed:', e))
  }

  private onDeviceKey(e: { ev?: string; k?: string }): void {
    if (e.ev !== 'key' || !this.view.on) return
    if (e.k === 'play') this.control('toggle')
    else if (e.k === 'next') this.control('next')
    else if (e.k === 'prev') this.control('prev')
    else if (e.k === 'back') this.stop() // holding P on the player leaves Spotify mode
  }

  /** Show the current song on the player: full details when the song changes, position every second. */
  private async mirror(): Promise<void> {
    const v = this.view
    if (!v.on || !this.device.connected || !v.available) return
    const key = `${v.title}|${v.artist}|${v.art}`
    if (key !== this.pushedKey) {
      this.pushedKey = key
      let art = ''
      try {
        if (existsSync(SPOTIFY_ART)) art = (await oledPicture(SPOTIFY_ART, 48)).toString('base64')
      } catch (e) {
        log('spotify art failed:', e)
      }
      await this.device.tryCall('remote', { on: true, title: deviceText(v.title).slice(0, 60), artist: deviceText(v.artist).slice(0, 40), art, dur: Math.round(v.dur), pos: Math.round(v.pos), playing: v.playing })
    } else if (Date.now() - this.lastPush > 900) {
      this.lastPush = Date.now()
      await this.device.tryCall('remote', { on: true, pos: Math.round(v.pos), playing: v.playing })
    }
  }
}
