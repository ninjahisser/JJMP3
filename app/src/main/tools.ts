// External programs the importer uses: yt-dlp (downloads) and ffmpeg (conversion, artwork).
// Found on the system when present, otherwise downloaded once into %APPDATA%\JJMP3\tools.
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync, renameSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import type { ToolsView } from '@shared/types'
import { TOOLS_DIR } from './paths'
import { log } from './log'

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
const FFMPEG_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
const UPDATE_STAMP = join(TOOLS_DIR, 'yt-dlp.updated')

export const tools: ToolsView = { ffmpeg: null, ytdlp: null }
export let onToolsChange: () => void = () => {}
export const setToolsListener = (f: () => void) => (onToolsChange = f)

function onPath(exe: string): string | null {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    const p = join(dir, exe)
    if (dir && existsSync(p)) return p
  }
  return null
}

/** ffmpeg folders that installers commonly leave behind (winget, manual unzips). */
function ffmpegGuesses(): string[] {
  const out: string[] = []
  const scan = (root: string, depth: number) => {
    if (depth < 0 || !existsSync(root)) return
    for (const name of readdirSync(root)) {
      const p = join(root, name)
      try {
        if (!statSync(p).isDirectory()) continue
      } catch {
        continue
      }
      if (existsSync(join(p, 'bin', 'ffmpeg.exe'))) out.push(join(p, 'bin', 'ffmpeg.exe'))
      else scan(p, depth - 1)
    }
  }
  const local = process.env.LOCALAPPDATA || ''
  scan(join(local, 'Microsoft', 'WinGet', 'Packages'), 2)
  scan('G:\tools\ffmpeg', 1)
  scan('C:\ffmpeg', 1)
  if (existsSync('C:\ffmpeg\bin\ffmpeg.exe')) out.push('C:\ffmpeg\bin\ffmpeg.exe')
  return out
}

export function detectTools(): void {
  const own = (n: string) => (existsSync(join(TOOLS_DIR, n)) ? join(TOOLS_DIR, n) : null)
  tools.ytdlp = own('yt-dlp.exe') || onPath('yt-dlp.exe')
  tools.ffmpeg = own('ffmpeg.exe') || onPath('ffmpeg.exe') || ffmpegGuesses()[0] || null
  onToolsChange()
}

/** A JavaScript runtime for yt-dlp's YouTube support: Node if installed, else Electron in Node mode. */
export function jsRuntime(): { arg: string; env: Record<string, string> } {
  const node = onPath('node.exe')
  if (node) return { arg: `node:${node}`, env: {} }
  return { arg: `node:${process.execPath}`, env: { ELECTRON_RUN_AS_NODE: '1' } }
}

async function download(url: string, dest: string, label: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  let last = 0
  const body = Readable.fromWeb(res.body as any)
  body.on('data', (c: Buffer) => {
    got += c.length
    if (Date.now() - last > 300) {
      last = Date.now()
      tools.busy = total ? `${label} ${Math.round((got / total) * 100)}%` : `${label} ${Math.round(got / 1e6)} MB`
      onToolsChange()
    }
  })
  await pipeline(body, createWriteStream(dest + '.part'))
  renameSync(dest + '.part', dest)
}

function extractFfmpeg(zipPath: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      zip.readEntry()
      zip.on('entry', (entry) => {
        if (!/\/bin\/ffmpeg\.exe$/.test(entry.fileName)) return zip.readEntry()
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e)
          pipeline(stream, createWriteStream(dest)).then(() => {
            zip.close()
            resolve()
          }, reject)
        })
      })
      zip.on('end', () => reject(new Error('ffmpeg.exe not found in the download')))
    })
  })
}

let installing: Promise<void> | null = null

/** Downloads whatever is missing. Safe to call repeatedly. */
export function ensureTools(): Promise<void> {
  if (!installing) {
    installing = (async () => {
      detectTools()
      try {
        if (!tools.ytdlp) {
          await download(YTDLP_URL, join(TOOLS_DIR, 'yt-dlp.exe'), 'Getting yt-dlp')
          writeFileSync(UPDATE_STAMP, String(Date.now()))
        }
        if (!tools.ffmpeg) {
          const zip = join(TOOLS_DIR, 'ffmpeg.zip')
          await download(FFMPEG_URL, zip, 'Getting ffmpeg')
          tools.busy = 'Unpacking ffmpeg'
          onToolsChange()
          await extractFfmpeg(zip, join(TOOLS_DIR, 'ffmpeg.exe'))
          try {
            renameSync(zip, zip + '.done') // keep nothing big around
          } catch {
            // ignore
          }
        }
      } finally {
        tools.busy = undefined
        detectTools()
        installing = null
      }
    })()
  }
  return installing
}

/** yt-dlp needs frequent updates to keep up with YouTube: at most once a week. */
export function updateYtDlpLater(): void {
  const own = join(TOOLS_DIR, 'yt-dlp.exe')
  if (!existsSync(own)) return
  const last = existsSync(UPDATE_STAMP) ? Number(readFileSync(UPDATE_STAMP, 'utf-8')) : 0
  if (Date.now() - last < 7 * 86400e3) return
  writeFileSync(UPDATE_STAMP, String(Date.now()))
  run(own, ['-U']).then((r) => log('yt-dlp update:', r.stdout.trim().split('\n').pop()), (e) => log('yt-dlp update failed', e))
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs a tool without a console window. onLine gets stdout line by line. */
export function run(exe: string, args: string[], opts: { onLine?: (line: string) => void; env?: Record<string, string>; input?: Buffer; binary?: boolean } = {}): Promise<RunResult & { out: Buffer }> {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true, env: { ...process.env, ...opts.env } })
    const chunks: Buffer[] = []
    let err = ''
    let pending = ''
    p.stdout.on('data', (d: Buffer) => {
      chunks.push(d)
      if (opts.onLine) {
        pending += d.toString()
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() || ''
        lines.forEach(opts.onLine)
      }
    })
    p.stderr.on('data', (d: Buffer) => (err += d.toString()))
    p.on('error', reject)
    p.on('close', (code) => {
      const out = Buffer.concat(chunks)
      resolve({ code: code ?? 1, stdout: opts.binary ? '' : out.toString(), stderr: err, out })
    })
    if (opts.input) p.stdin.end(opts.input)
    else p.stdin.end()
  })
}
