// One set of controls, two outputs: the JJMP3 player (over USB/Wi-Fi) or this computer's speakers.
// Switching hands the current song, queue and position over to the other output.
import { create } from 'zustand'
import { call, useStore } from './store'

export type Output = 'player' | 'computer'

interface LocalState {
  output: Output
  queue: string[] // what was last asked to play, on either output
  trackId?: string // computer playback
  index: number
  playing: boolean
  pos: number
  dur: number
  vol: number
  shuffle: boolean
  repeat: 0 | 1 | 2
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('jjmp3.local') || '{}')
  } catch {
    return {}
  }
})()

export const usePlayback = create<LocalState>(() => ({
  output: saved.output === 'computer' ? 'computer' : 'player',
  queue: [],
  index: 0,
  playing: false,
  pos: 0,
  dur: 0,
  vol: typeof saved.vol === 'number' ? saved.vol : 70,
  shuffle: false,
  repeat: 1
}))

const remember = () => {
  const { output, vol } = usePlayback.getState()
  try {
    localStorage.setItem('jjmp3.local', JSON.stringify({ output, vol }))
  } catch {
    // private mode / storage blocked: fine
  }
}

const audio = new Audio()
audio.preload = 'auto'
audio.volume = usePlayback.getState().vol / 100
audio.addEventListener('timeupdate', () => usePlayback.setState({ pos: audio.currentTime }))
audio.addEventListener('loadedmetadata', () => usePlayback.setState({ dur: audio.duration || 0 }))
audio.addEventListener('play', () => usePlayback.setState({ playing: true }))
audio.addEventListener('pause', () => usePlayback.setState({ playing: false }))
audio.addEventListener('ended', () => (usePlayback.getState().repeat === 2 ? playIndex(usePlayback.getState().index) : localStep(1, true)))
audio.addEventListener('error', () => useStore.getState().toast("This song can't play on the computer (its file isn't here).", true))

/** Songs this computer has a file for, in the given order. */
const playable = (ids: string[]) => {
  const tracks = useStore.getState().snap.tracks
  return ids.filter((id) => tracks.some((t) => t.id === id && !t.deviceOnly))
}

function playIndex(i: number, pos = 0, autoplay = true): void {
  const { queue } = usePlayback.getState()
  const id = queue[i]
  if (!id) return
  usePlayback.setState({ trackId: id, index: i, pos, dur: 0 })
  audio.src = `jjmp3://media/${id}`
  audio.currentTime = pos
  if (autoplay) void audio.play().catch(() => {})
}

function localStep(dir: 1 | -1, fromEnd = false): void {
  const { queue, index, shuffle, repeat } = usePlayback.getState()
  if (!queue.length) return
  if (dir < 0 && audio.currentTime > 3) return playIndex(index)
  let i = shuffle && dir > 0 && queue.length > 1 ? (index + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length : index + dir
  if (i >= queue.length) {
    if (repeat === 0 && fromEnd) return void audio.pause()
    i = 0
  }
  if (i < 0) i = queue.length - 1
  playIndex(i)
}

function queueFor(playlistId?: string): string[] {
  const { snap } = useStore.getState()
  if (playlistId) return snap.playlists.find((p) => p.id === playlistId)?.tracks ?? []
  return snap.tracks.map((t) => t.id)
}

// ---------- the controls the UI uses ----------

export function playTrack(trackId: string, playlistId?: string): void {
  const queue = queueFor(playlistId)
  usePlayback.setState({ queue })
  if (usePlayback.getState().output === 'computer') {
    const q = playable(queue)
    usePlayback.setState({ queue: q })
    playIndex(Math.max(0, q.indexOf(trackId)))
  } else {
    void call('play', { trackId, playlistId })
  }
}

export function playList(playlistId: string, shuffle: boolean): void {
  const queue = queueFor(playlistId)
  if (!queue.length) return
  const start = shuffle ? queue[Math.floor(Math.random() * queue.length)] : queue[0]
  if (usePlayback.getState().output === 'computer') {
    usePlayback.setState({ shuffle })
    playTrack(start, playlistId)
  } else {
    usePlayback.setState({ queue })
    void call('play', { trackId: start, playlistId, shuffle })
  }
}

const onComputer = () => usePlayback.getState().output === 'computer'

export const controls = {
  toggle: () => (onComputer() ? (audio.src ? (audio.paused ? void audio.play() : audio.pause()) : playTrack(queueFor()[0] || '')) : void call('control', 'toggle')),
  next: () => (onComputer() ? localStep(1) : void call('control', 'next')),
  prev: () => (onComputer() ? localStep(-1) : void call('control', 'prev')),
  seek: (sec: number) => (onComputer() ? (audio.currentTime = sec) : void call('control', 'seek', { pos: Math.round(sec) })),
  volume: (v: number) => {
    if (onComputer()) {
      audio.volume = v / 100
      usePlayback.setState({ vol: v })
      remember()
    } else void call('control', 'vol', { v })
  },
  shuffle: (on: boolean) => (onComputer() ? usePlayback.setState({ shuffle: on }) : void call('control', 'mode', { shuffle: on })),
  repeat: (r: 0 | 1 | 2) => (onComputer() ? usePlayback.setState({ repeat: r }) : void call('control', 'mode', { repeat: r }))
}

/** Hand the music over to the other output, at the same song and second. */
export async function switchOutput(to: Output): Promise<void> {
  const pb = usePlayback.getState()
  if (pb.output === to) return
  const st = useStore.getState().snap.device.status
  if (to === 'computer') {
    const wasPlaying = st.state === 'playing'
    if (wasPlaying) await call('control', 'pause')
    usePlayback.setState({ output: 'computer' })
    remember()
    if (st.track) {
      const q = playable(pb.queue.length ? pb.queue : queueFor())
      const queue = q.includes(st.track) ? q : [st.track, ...q]
      usePlayback.setState({ queue, repeat: (st.repeat ?? 1) as 0 | 1 | 2, shuffle: !!st.shuffle })
      playIndex(queue.indexOf(st.track), st.pos || 0, wasPlaying)
    }
  } else {
    const wasPlaying = !audio.paused
    const pos = audio.currentTime
    audio.pause()
    usePlayback.setState({ output: 'player' })
    remember()
    if (pb.trackId && useStore.getState().snap.device.connected) {
      const onPlayer = useStore.getState().snap.tracks.filter((t) => t.onDevice || t.deviceOnly).map((t) => t.id)
      const queue = pb.queue.filter((id) => onPlayer.includes(id))
      if (!queue.includes(pb.trackId)) return useStore.getState().toast("That song isn't on the player yet.", true)
      if (!(await call('play', { trackId: pb.trackId, queue }))) return
      await call('control', 'mode', { shuffle: pb.shuffle, repeat: pb.repeat })
      if (pos > 1) await call('control', 'seek', { pos: Math.round(pos) })
      if (!wasPlaying) await call('control', 'pause')
    }
  }
}

/** What the player bar shows, whichever output is active. */
export function useNowPlaying() {
  const pb = usePlayback()
  const snap = useStore((s) => s.snap)
  const statusAt = useStore((s) => s.statusAt)
  const st = snap.device.status
  if (pb.output === 'computer') {
    const t = snap.tracks.find((x) => x.id === pb.trackId)
    return { output: pb.output, track: t, title: t?.title, artist: t?.artist, playing: pb.playing, pos: pb.pos, dur: pb.dur || t?.duration || 0, live: false, vol: pb.vol, shuffle: pb.shuffle, repeat: pb.repeat, statusAt }
  }
  const t = snap.tracks.find((x) => x.id === st.track)
  return {
    output: pb.output, track: t, title: t?.title || st.title, artist: t?.artist || st.artist, playing: st.state === 'playing',
    pos: st.pos || 0, dur: st.dur || 0, live: st.state === 'playing' && st.bt?.state === 'connected', vol: st.vol ?? 60,
    shuffle: !!st.shuffle, repeat: (st.repeat ?? 1) as 0 | 1 | 2, statusAt
  }
}