import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { IconButton } from './ui'
import { Cover } from './TrackRow'
import { call, fmt, useStore, useTrack } from '../store'

const control = (cmd: string, params: Record<string, unknown> = {}) => void call('control', cmd, params)

function Progress() {
  const st = useStore((s) => s.snap.device.status)
  const statusAt = useStore((s) => s.statusAt)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [])
  let pos = st.pos || 0
  if (st.state === 'playing' && st.bt?.state === 'connected') pos += (performance.now() - statusAt) / 1000
  const dur = st.dur || 0
  pos = dur ? Math.min(pos, dur) : pos
  return (
    <div className="seek">
      <span className="mono">{fmt(pos)}</span>
      <div
        className="rail"
        onClick={(e) => {
          if (!dur) return
          const r = e.currentTarget.getBoundingClientRect()
          control('seek', { pos: Math.round(((e.clientX - r.left) / r.width) * dur) })
        }}
      >
        <div>
          <i style={{ width: dur ? `${(pos / dur) * 100}%` : 0 }} />
        </div>
      </div>
      <span className="mono">{fmt(dur)}</span>
    </div>
  )
}

function Volume() {
  const vol = useStore((s) => s.snap.device.status.vol)
  const [v, setV] = useState(vol ?? 60)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging && vol != null) setV(vol)
  }, [vol, dragging])
  useEffect(() => {
    if (!dragging) return
    const t = setTimeout(() => control('vol', { v }), 120)
    return () => clearTimeout(t)
  }, [v, dragging])
  return (
    <input
      type="range"
      min={0}
      max={100}
      value={v}
      style={{ ['--v' as string]: `${v}%` }}
      onPointerDown={() => setDragging(true)}
      onPointerUp={() => setTimeout(() => setDragging(false), 400)}
      onChange={(e) => setV(+e.target.value)}
    />
  )
}

export function PlayerBar() {
  const device = useStore((s) => s.snap.device)
  const st = device.status
  const t = useTrack(st.track)
  let title = 'Nothing playing'
  let artist = 'Connect your JJMP3 via USB'
  if (device.connected) {
    if (st.track) {
      title = t?.title || st.title || ''
      artist = t?.artist || st.artist || ''
    } else if (st.mode === 'wifi') {
      title = 'Wi-Fi mode'
      artist = 'Switch to music mode to listen'
    } else {
      title = 'Ready'
      artist = st.bt?.state === 'connected' ? 'Pick a song to play' : 'Connect headphones under Player'
    }
  }
  const repeat = st.repeat || 0
  return (
    <footer className={`player ${device.connected ? '' : 'off'}`}>
      <div className="now">
        <Cover track={device.connected ? t : undefined} size="lg" />
        <div className="meta">
          <div className="title">{title}</div>
          <div className="artist">{artist}</div>
        </div>
      </div>
      <div className="transport">
        <div className="ctl">
          <IconButton icon="shuffle" title="Shuffle" on={!!st.shuffle} onClick={() => control('mode', { shuffle: !st.shuffle })} />
          <IconButton icon="prev" title="Previous" onClick={() => control('prev')} />
          <button className="play-btn" title="Play / pause" onClick={() => control('toggle')}>
            <Icon name={st.state === 'playing' ? 'pause' : 'play'} size={20} />
          </button>
          <IconButton icon="next" title="Next" onClick={() => control('next')} />
          <button className={`icon-btn ${repeat ? 'on' : ''}`} title={['Repeat off', 'Repeat all', 'Repeat one'][repeat]} onClick={() => control('mode', { repeat: (repeat + 1) % 3 })}>
            <Icon name="repeat" />
            {repeat === 2 && <span className="badge">1</span>}
          </button>
        </div>
        <Progress />
      </div>
      <div className="right">
        <Icon name="vol" />
        <Volume />
      </div>
    </footer>
  )
}