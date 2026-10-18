import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNEL } from '@shared/types'

const api = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>,
  /** Main-process pushes (state snapshots). Returns an unsubscribe. */
  on: (fn: (channel: string, payload: unknown) => void) => {
    const l = (_e: unknown, channel: string, payload: unknown) => fn(channel, payload)
    ipcRenderer.on(EVENT_CHANNEL, l)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, l)
  }
}

contextBridge.exposeInMainWorld('jjmp3', api)
export type Jjmp3Api = typeof api