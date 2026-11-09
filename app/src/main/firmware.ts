// The player firmware that ships inside the app (packed by firmware/release.ps1), and installing it
// over USB with the bundled esptool, so nobody needs Arduino or a compiler.
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FirmwareView } from '@shared/types'
import { log } from './log'

/** Packaged: resources\firmware. From source (npm run dev): app\firmware. */
export function firmwareDir(): string {
  const packed = join(process.resourcesPath, 'firmware')
  return app.isPackaged || existsSync(packed) ? packed : join(app.getAppPath(), 'firmware')
}

const file = (name: string) => join(firmwareDir(), name)

export const firmware: FirmwareView = { version: null, busy: null }
let onChange: () => void = () => {}
export function setFirmwareListener(fn: () => void): void {
  onChange = fn
}

export function loadFirmwareInfo(): void {
  try {
    firmware.version = readFileSync(file('version.txt'), 'utf8').trim() || null
  } catch {
    firmware.version = null
  }
}

function busy(text: string | null): void {
  firmware.busy = text
  onChange()
}

/** The two app images, for the update over Wi-Fi. */
export function images(): { wifi: Buffer; music: Buffer } {
  if (!existsSync(file('wifi.bin')) || !existsSync(file('music.bin'))) throw new Error('This copy of the app has no player firmware in it.')
  return { wifi: readFileSync(file('wifi.bin')), music: readFileSync(file('music.bin')) }
}

function esptool(port: string, baud: number): Promise<void> {
  // bootloader, partition table, OTA data (boots music mode), music mode, Wi-Fi mode: the same layout as firmware/flash.ps1.
  // Settings, Wi-Fi and paired headphones live in NVS, which this leaves alone.
  const args = ['--chip', 'esp32', '--port', port, '--baud', String(baud), 'write-flash',
    '0x1000', file('bootloader.bin'), '0x8000', file('partitions.bin'), '0xe000', file('boot_app0.bin'),
    '0x10000', file('music.bin'), '0x1F0000', file('wifi.bin')]
  return new Promise((resolve, reject) => {
    const p = spawn(file('esptool.exe'), args, { windowsHide: true })
    let tail = ''
    let image = 0
    const take = (d: Buffer) => {
      const text = d.toString()
      tail = (tail + text).slice(-2000)
      if (/Connecting/.test(text)) busy('Connecting to the board…')
      if (/Compressed \d+ bytes/.test(text)) image++
      const pct = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].pop()
      if (pct && image >= 4) busy(`Writing ${image === 4 ? 'music mode' : 'Wi-Fi mode'} · ${Math.round(Number(pct[1]))} %`)
    }
    p.stdout.on('data', take)
    p.stderr.on('data', take)
    p.on('error', (e) => reject(e))
    p.on('close', (code) => {
      log('esptool', port, baud, 'exit', code, tail.slice(-400))
      if (code === 0) resolve()
      else {
        const why = /busy|Access is denied|could not open port/i.test(tail)
          ? `${port} is in use by another program (a serial monitor, Arduino IDE?). Close it and try again.`
          : /Failed to connect|No serial data received|Wrong boot mode/i.test(tail)
            ? 'The board did not answer. Hold its BOOT button while the install starts, then try again.'
            : (tail.trim().split('\n').pop() || `esptool stopped (${code})`)
        reject(new Error(why))
      }
    })
  })
}

/** Writes the bundled firmware to the ESP32 on `port`; falls back to a slower speed for picky USB chips. */
export async function installOverUsb(port: string): Promise<void> {
  if (!existsSync(file('esptool.exe'))) throw new Error('This copy of the app has no player firmware in it.')
  busy('Connecting to the board…')
  try {
    try {
      await esptool(port, 921600)
    } catch (e) {
      if (/in use/.test((e as Error).message)) throw e
      log('flash at 921600 failed, retrying at 115200:', (e as Error).message)
      busy('Retrying at a slower speed…')
      await esptool(port, 115200)
    }
  } finally {
    busy(null)
  }
}
