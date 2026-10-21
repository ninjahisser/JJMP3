// Connection to the JJMP3 player over USB serial or Wi-Fi (HTTP).
// Both speak the JSON command protocol in firmware/jjmp3/protocol.h.
import { SerialPort } from 'serialport'
import type { DeviceStatus, DeviceView } from '@shared/types'
import { log } from './log'

const BAUD = 921600
const USB_IDS = new Set(['10c4:ea60', '1a86:7523', '1a86:55d4', '303a:1001'])

export class LinkError extends Error {}

type Reply = Record<string, any>
type Progress = (done: number, total: number) => void

interface Link {
  kind: 'usb' | 'wifi'
  where: string
  request(cmd: string, params?: Record<string, unknown>, timeout?: number): Promise<Reply>
  put(path: string, data: Buffer, progress?: Progress): Promise<void>
  get(path: string): Promise<Buffer>
  close(): void
}

class SerialLink implements Link {
  kind = 'usb' as const
  private buf = Buffer.alloc(0)
  private wake: (() => void)[] = []
  private closed = false
  private nextId = 1

  private constructor(private port: SerialPort, public where: string) {
    port.on('data', (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d])
      this.notify()
    })
    const end = () => {
      this.closed = true
      this.notify()
    }
    port.on('close', end)
    port.on('error', end)
  }

  static open(path: string): Promise<SerialLink> {
    return new Promise((resolve, reject) => {
      // hupcl off and no line changes after opening, so the auto-reset circuit stays idle
      const port = new SerialPort({ path, baudRate: BAUD, autoOpen: false, hupcl: false })
      port.open((err) => (err ? reject(err) : resolve(new SerialLink(port, path))))
    })
  }

  close(): void {
    this.closed = true
    if (this.port.isOpen) this.port.close(() => {})
  }

  private notify(): void {
    const w = this.wake
    this.wake = []
    w.forEach((f) => f())
  }

  private async waitData(deadline: number): Promise<void> {
    if (this.closed) throw new LinkError('player disconnected')
    const left = deadline - Date.now()
    if (left <= 0) throw new LinkError('player did not answer')
    await new Promise<void>((res) => {
      const t = setTimeout(res, left)
      this.wake.push(() => {
        clearTimeout(t)
        res()
      })
    })
  }

  private async readLine(deadline: number): Promise<string> {
    for (;;) {
      const nl = this.buf.indexOf(10)
      if (nl >= 0) {
        const line = this.buf.subarray(0, nl).toString('latin1')
        this.buf = this.buf.subarray(nl + 1)
        return line
      }
      await this.waitData(deadline)
    }
  }

  private async readJson(deadline: number): Promise<Reply> {
    for (;;) {
      const line = (await this.readLine(deadline)).trim()
      if (!line.startsWith('{')) continue // boot messages and log lines
      try {
        return JSON.parse(line)
      } catch {
        // garbled line, keep reading
      }
    }
  }

  private write(data: Buffer | string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new LinkError('player disconnected'))
      this.port.write(data, (err) => (err ? reject(new LinkError(err.message)) : this.port.drain(() => resolve())))
    })
  }

  private async send(msg: Record<string, unknown>): Promise<number> {
    const id = this.nextId++
    await this.write(JSON.stringify({ ...msg, id }) + '\n')
    return id
  }

  private async reply(id: number, deadline: number): Promise<Reply> {
    for (;;) {
      const r = await this.readJson(deadline)
      if (r.id === id) return r
    }
  }

  async request(cmd: string, params: Record<string, unknown> = {}, timeout = 6000): Promise<Reply> {
    const id = await this.send({ cmd, ...params })
    return this.reply(id, Date.now() + timeout)
  }

  async put(path: string, data: Buffer, progress?: Progress): Promise<void> {
    const id = await this.send({ cmd: 'put', path, size: data.length })
    const r = await this.reply(id, Date.now() + 8000)
    if (!r.ok) throw new LinkError(r.error || 'upload refused')
    const chunk: number = r.chunk || 2048
    let off = 0
    while (off < data.length) {
      await this.write(data.subarray(off, off + chunk))
      off = Math.min(off + chunk, data.length)
      const ack = await this.readJson(Date.now() + 8000)
      if (ack.ok === false) throw new LinkError(ack.error || 'upload failed')
      progress?.(off, data.length)
    }
    const done = await this.reply(id, Date.now() + 10000)
    if (!done.ok) throw new LinkError(done.error || 'upload failed')
  }

  async get(path: string): Promise<Buffer> {
    const id = await this.send({ cmd: 'get', path })
    const r = await this.reply(id, Date.now() + 8000)
    if (!r.ok) throw new LinkError(r.error || 'not found')
    const n: number = r.size
    const deadline = Date.now() + 10000 + n / 50
    while (this.buf.length < n) await this.waitData(deadline)
    const out = Buffer.from(this.buf.subarray(0, n))
    this.buf = this.buf.subarray(n)
    return out
  }
}

class HttpLink implements Link {
  kind = 'wifi' as const
  constructor(public where: string) {}

  close(): void {}

  async request(cmd: string, params: Record<string, unknown> = {}, timeout = 6000): Promise<Reply> {
    try {
      const r = await fetch(`http://${this.where}/cmd`, {
        method: 'POST',
        body: JSON.stringify({ cmd, ...params }),
        signal: AbortSignal.timeout(timeout)
      })
      return (await r.json()) as Reply
    } catch (e) {
      throw new LinkError((e as Error).message)
    }
  }

  async put(path: string, data: Buffer, progress?: Progress): Promise<void> {
    const boundary = '----jjmp3boundary'
    const name = path.split('/').pop()
    const head = `--${boundary}` + '\r\n' + `Content-Disposition: form-data; name="file"; filename="${name}"` + '\r\n' +
      'Content-Type: application/octet-stream' + '\r\n\r\n'
    const body = Buffer.concat([Buffer.from(head), data, Buffer.from('\r\n' + `--${boundary}--` + '\r\n')])
    const url = `http://${this.where}/upload?path=${encodeURIComponent(path)}&size=${data.length}`
    try {
      const r = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        signal: AbortSignal.timeout(30000 + data.length / 20)
      })
      if (!r.ok) throw new LinkError(`upload failed (${r.status})`)
      progress?.(data.length, data.length)
    } catch (e) {
      throw e instanceof LinkError ? e : new LinkError((e as Error).message)
    }
  }

  async get(path: string): Promise<Buffer> {
    let r: Response
    try {
      r = await fetch(`http://${this.where}/file?path=${encodeURIComponent(path)}`, { signal: AbortSignal.timeout(20000) })
    } catch (e) {
      throw new LinkError((e as Error).message)
    }
    if (!r.ok) throw new LinkError('not found')
    return Buffer.from(await r.arrayBuffer())
  }
}

/** One operation on the link at a time, so the status poll and file uploads never interleave. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve()
  busy = false

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      this.busy = true
      try {
        return await fn()
      } finally {
        this.busy = false
      }
    })
    this.tail = next.catch(() => {})
    return next
  }
}

/** Finds the player (USB first, then Wi-Fi), keeps its status fresh, and runs every command. */
export class Device {
  private link: Link | null = null
  private mutex = new Mutex()
  status: DeviceStatus = {}
  info: DeviceView['info'] = {}
  error = ''
  onConnect: (() => void)[] = []
  onChange: () => void = () => {}

  constructor(private wifiHost: () => string | null, private setWifiHost: (h: string) => void) {
    void this.run()
  }

  get connected(): boolean {
    return this.link !== null
  }

  view(): DeviceView {
    return {
      connected: !!this.link,
      via: this.link?.kind ?? null,
      where: this.link?.where ?? null,
      info: this.info,
      status: this.status,
      error: this.error
    }
  }

  private need(): Link {
    if (!this.link) throw new LinkError('The player is not connected.')
    return this.link
  }

  private lose(why: string): void {
    log('link lost:', why)
    this.link?.close()
    this.link = null
    this.status = {}
    this.error = why
    this.onChange()
  }

  private guard<T>(fn: (link: Link) => Promise<T>, keepOnNotFound = false): Promise<T> {
    return this.mutex.run(async () => {
      const link = this.need()
      try {
        return await fn(link)
      } catch (e) {
        if (e instanceof LinkError && !(keepOnNotFound && e.message === 'not found')) this.lose(e.message)
        throw e
      }
    })
  }

  call(cmd: string, params: Record<string, unknown> = {}, timeout = 6000): Promise<Reply> {
    return this.guard((l) => l.request(cmd, params, timeout))
  }

  /** Like call(), but gives up instead of queueing behind a long upload. */
  async tryCall(cmd: string, params: Record<string, unknown> = {}): Promise<Reply | null> {
    if (this.mutex.busy || !this.link) return null
    return this.call(cmd, params, 3000).catch(() => null)
  }

  /**
   * A UI poll (the OLED mirror). Unlike tryCall it waits its turn behind the
   * status poll instead of being dropped, but with a short timeout so it never
   * hogs the single serial link: a stale frame beats a blank mirror. Skipped
   * only while a file upload is in flight, where the link is busy for seconds.
   */
  async poll(cmd: string, params: Record<string, unknown> = {}, timeout = 2500): Promise<Reply | null> {
    if (!this.link) return null
    return this.call(cmd, params, timeout).catch(() => null)
  }

  put(path: string, data: Buffer, progress?: Progress): Promise<void> {
    return this.guard((l) => l.put(path, data, progress))
  }

  get(path: string): Promise<Buffer> {
    return this.guard((l) => l.get(path), true)
  }

  private async tryUsb(): Promise<[Link, Reply] | null> {
    let ports: Awaited<ReturnType<typeof SerialPort.list>> = []
    try {
      ports = await SerialPort.list()
    } catch {
      return null
    }
    for (const p of ports) {
      if (!USB_IDS.has(`${(p.vendorId || '').toLowerCase()}:${(p.productId || '').toLowerCase()}`)) continue
      let link: SerialLink
      try {
        link = await SerialLink.open(p.path)
      } catch {
        continue // in use by another program, or unplugged
      }
      try {
        const hello = await link.request('hello', {}, 1500)
        if (hello.name === 'JJMP3') return [link, hello]
      } catch {
        // not a JJMP3, or still booting
      }
      link.close()
    }
    return null
  }

  private async tryWifi(): Promise<[Link, Reply] | null> {
    for (const host of [this.wifiHost(), 'jjmp3.local'].filter(Boolean) as string[]) {
      const link = new HttpLink(host)
      try {
        const hello = await link.request('hello', {}, 1500)
        if (hello.name === 'JJMP3') return [link, hello]
      } catch {
        // not there
      }
    }
    return null
  }

  private attach([link, hello]: [Link, Reply]): void {
    this.link = link
    this.info = hello
    this.error = ''
    log('connected via', link.kind, link.where, hello)
    this.onChange()
    this.onConnect.forEach((f) => f())
  }

  private async run(): Promise<void> {
    let lastWifiTry = 0
    let misses = 0
    for (;;) {
      if (!this.link) {
        misses = 0
        let found = await this.tryUsb()
        if (!found && Date.now() - lastWifiTry > 8000) {
          lastWifiTry = Date.now()
          found = await this.tryWifi()
        }
        if (found) this.attach(found)
        await sleep(1500)
        continue
      }
      if (this.link.kind === 'wifi' && !this.mutex.busy) {
        const usb = await this.tryUsb() // prefer the cable when it appears
        if (usb) {
          this.link.close()
          this.link = null
          this.attach(usb)
        }
      }
      if (!this.mutex.busy) {
        try {
          // Short timeout: status is a tiny reply, so if it takes this long the
          // link is bad. Keeping it short also means the OLED mirror's screen
          // poll (queued behind this on the one serial link) rarely waits long
          // enough to time out and drop a frame.
          const st = await this.mutex.run(() => this.need().request('status', {}, 2000))
          this.status = st as DeviceStatus
          misses = 0
          const ip = this.status.wifi?.ip
          if (ip && ip !== this.wifiHost()) this.setWifiHost(ip)
          this.onChange()
        } catch (e) {
          // One missed poll is not a disconnection: the device may just be busy
          // (SD scan, flash write, a big screen frame). Only give up after a
          // few in a row, so a single hiccup doesn't make the app flap.
          if (e instanceof LinkError) {
            if (e.message === 'player disconnected') this.lose(e.message)
            else if (++misses >= 5) this.lose(e.message)
          }
        }
      }
      await sleep(1000)
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))