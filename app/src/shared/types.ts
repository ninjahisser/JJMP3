// Types shared by the main process and the renderer.

export interface Track {
  id: string
  title: string
  artist: string
  duration: number
  source?: 'youtube' | 'spotify'
  url?: string
  cover?: boolean
  size?: number
  added?: number
  recovered?: boolean // details came back from the player's index or are missing; pasting the link again restores them
  // view-only fields, filled in by the main process
  onDevice?: boolean
  uploading?: number | null
  deviceOnly?: boolean
}

export interface Playlist {
  id: string
  name: string
  tracks: string[]
  created: number
}

export type JobState =
  | 'resolving' | 'queued' | 'matching' | 'downloading' | 'converting' | 'artwork'
  | 'done' | 'error' | 'skipped'

export interface Job {
  id: string
  url: string
  title: string
  artist?: string
  state: JobState
  progress: number
  error?: string
  trackId?: string
  created: number
}

export interface DeviceStatus {
  mode?: 'music' | 'wifi'
  state?: 'playing' | 'paused' | 'stopped'
  track?: string
  title?: string
  artist?: string
  pos?: number
  dur?: number
  vol?: number
  qpos?: number
  qlen?: number
  repeat?: 0 | 1 | 2
  shuffle?: boolean
  tracks?: number
  error?: string
  heap?: number
  bt?: { state: string; name: string; events?: string[] }
  wifi?: { state: string; ssid: string; ip: string }
  battery?: { pct: number; v: number } // only when a battery is wired
  user?: string
}

export interface DeviceView {
  connected: boolean
  via: 'usb' | 'wifi' | null
  where: string | null
  info: { name?: string; fw?: string; mode?: string; tracks?: number }
  status: DeviceStatus
  error: string
}

export interface ToolsView {
  ffmpeg: string | null
  ytdlp: string | null
  busy?: string
}

export interface Snapshot {
  device: DeviceView
  sync: { loaded: boolean; error: string; busy: boolean }
  tracks: Track[]
  playlists: Playlist[]
  jobs: Job[]
  tools: ToolsView
  theme: 'light' | 'dark'
  palette: 'green' | 'paper' | 'slate'
}

export const EVENT_CHANNEL = 'jjmp3:event'
