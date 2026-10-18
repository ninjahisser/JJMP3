import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Everything lives in %APPDATA%\JJMP3 (override with JJMP3_PROFILE for testing).
export const DATA_DIR = process.env.JJMP3_PROFILE || join(app.getPath('appData'), 'JJMP3')
export const MEDIA_DIR = join(DATA_DIR, 'media') // converted mp3s, as uploaded to the player
export const COVER_DIR = join(DATA_DIR, 'covers') // 600px artwork for the app
export const ART_DIR = join(DATA_DIR, 'art') // 64x64 1-bit artwork for the OLED
export const TOOLS_DIR = join(DATA_DIR, 'tools') // yt-dlp.exe, ffmpeg.exe
export const TMP_DIR = join(DATA_DIR, 'tmp')
export const LIBRARY_FILE = join(DATA_DIR, 'library.json')
export const LOG_FILE = join(DATA_DIR, 'jjmp3.log')

for (const d of [DATA_DIR, MEDIA_DIR, COVER_DIR, ART_DIR, TOOLS_DIR, TMP_DIR]) mkdirSync(d, { recursive: true })
