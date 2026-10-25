import { create } from 'zustand'
import type { ReactNode } from 'react'
import type { Snapshot, Track } from '@shared/types'
import { findTheme } from '@shared/themes'

export type Page = { name: 'settings' } | { name: 'library' } | { name: 'playlists' } | { name: 'playlist'; id: string } | { name: 'games' } | { name: 'karaoke' } | { name: 'spotify' } | { name: 'player' }

export interface Toast {
  id: number
  text: string
  err?: boolean
}

export interface MenuItem {
  label: string
  icon?: string
  danger?: boolean
  heading?: boolean
  separator?: boolean
  onClick?: () => void
}

interface Store {
  snap: Snapshot
  statusAt: number // when the last player status arrived, for smooth progress
  page: Page
  filter: string
  toasts: Toast[]
  menu: { x: number; y: number; items: MenuItem[] } | null
  dialog: ReactNode | null
  go(page: Page): void
  toast(text: string, err?: boolean): void
  openMenu(anchor: Element, items: MenuItem[]): void
  closeMenu(): void
  openDialog(node: ReactNode): void
  closeDialog(): void
  setFilter(f: string): void
}

const empty: Snapshot = {
  device: { connected: false, via: null, where: null, info: {}, status: {}, error: '' },
  sync: { loaded: false, error: '', busy: false },
  tracks: [],
  playlists: [],
  jobs: [],
  tools: { ffmpeg: null, ytdlp: null },
  theme: 'light',
  palette: 'green',
  spotify: { on: false, available: false, title: '', artist: '', album: '', app: '', playing: false, pos: 0, dur: 0, art: 0 }
}

let toastId = 0

export const useStore = create<Store>((set) => ({
  snap: empty,
  statusAt: 0,
  page: { name: 'library' },
  filter: '',
  toasts: [],
  menu: null,
  dialog: null,
  go: (page) => set({ page, menu: null }),
  toast: (text, err) => {
    const id = ++toastId
    set((s) => ({ toasts: [...s.toasts, { id, text, err }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800)
  },
  openMenu: (anchor, items) => {
    const r = anchor.getBoundingClientRect()
    set({ menu: { x: r.right, y: r.bottom + 6, items } })
  },
  closeMenu: () => set({ menu: null }),
  openDialog: (dialog) => set({ dialog, menu: null }),
  closeDialog: () => set({ dialog: null }),
  setFilter: (filter) => set({ filter })
}))

/** Calls the main process; failures become a red toast and resolve to undefined. */
export async function call<T = any>(channel: string, ...args: unknown[]): Promise<T | undefined> {
  try {
    return await window.jjmp3.invoke<T>(channel, ...args)
  } catch (e) {
    const msg = String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    useStore.getState().toast(msg, true)
    return undefined
  }
}

const COLOR_VARS = ['paper', 'paper-2', 'sheet', 'ink', 'ink-2', 'ink-3', 'rule', 'rule-2', 'accent', 'ok', 'ink-hover']

export const applyTheme = (mode: 'light' | 'dark', palette = 'green') => {
  const t = findTheme(palette, mode)
  const root = document.documentElement
  root.dataset.theme = t.mode
  root.dataset.palette = t.palette
  for (const v of COLOR_VARS) {
    if (t.colors) root.style.setProperty(`--${v}`, t.colors[v as keyof typeof t.colors])
    else root.style.removeProperty(`--${v}`)
  }
}

export async function boot(): Promise<void> {
  const snap = await window.jjmp3.invoke<Snapshot>('state')
  applyTheme(snap.theme, snap.palette)
  useStore.setState({ snap, statusAt: performance.now() })
  window.jjmp3.on((channel, payload) => {
    if (channel === 'media') window.dispatchEvent(new CustomEvent('jjmp3-media', { detail: payload }))
    if (channel === 'state') {
      useStore.setState({ snap: payload as Snapshot, statusAt: performance.now() })
      applyTheme((payload as Snapshot).theme, (payload as Snapshot).palette)
    }
    if (channel === 'dev:go') useStore.getState().go(payload as Page)
  })
}

export const useTrack = (id?: string): Track | undefined => useStore((s) => s.snap.tracks.find((t) => t.id === id))
export const coverUrl = (t?: Track) => (t?.cover ? `jjmp3://cover/${t.id}` : undefined)

export const fmt = (s = 0) => {
  s = Math.max(0, Math.round(s))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export const fmtLong = (s: number) => {
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`