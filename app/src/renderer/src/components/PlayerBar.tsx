import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { IconButton } from './ui'
import { Cover } from './TrackRow'
import { fmt, useStore } from '../store'
import { controls, switchOutput, useNowPlaying, usePlayback } from '../playback'

function Progress({ pos, dur, live, statusAt }: { pos: number; dur: number; live: boolean; statusAt: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [])
  if (live) pos += (performance.now() - statusAt) / 1000
  pos = dur ? Math.min(pos, dur) : pos
  return (
    <div className="seek">
      <span className="mono">{fmt(pos)}</span>
      <div
        className="rail"
        onClick={(e) => {
          if (!dur) return
          const r = e.currentTarget.getBoundingClientRect()
          controls.seek(((e.clientX - r.left) / r.width) * dur)
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

/** Volume slider; shows the percentage above the thumb while it's being dragged. */
function Volume({ value }: { value: number }) {
  const [v, setV] = useState(value)
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging) setV(value)
  }, [value, dragging])
  useEffect(() => {
    if (!dragging) return
    const t = setTimeout(() => controls.volume(v), 120)
    return () => clearTimeout(t)
  }, [v, dragging])
  return (
    <div className={`vol ${dragging ? 'dragging' : ''}`}>
      <input
        type="range"
        min={0}
        max={100}
        value={v}
        style={{ ['--v' as string]: `${v}%` }}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setTimeout(() => setDragging(false), 500)}
        onKeyUp={() => controls.volume(v)}
        onChange={(e) => setV(+e.target.value)}
        aria-label="Volume"
      />
      <span className="vol-tip mono" style={{ left: `calc(${v}% + ${(50 - v) * 0.11}px)` }}>
        {v}%
      </span>
    </div>
  )
}

function OutputSwitch() {
  const output = usePlayback((s) => s.output)
  const connected = useStore((s) => s.snap.device.connected)
  return (
    <div className="output" role="radiogroup" aria-label="Listen on">
      <button className={output === 'player' ? 'on' : ''} disabled={!connected && output !== 'player'} title="Listen on the Z0Ɛ player" onClick={() => void switchOutput('player')}>
        <Icon name="player" size={15} />
        Z0Ɛ
      </button>
      <button className={output === 'computer' ? 'on' : ''} title="Listen on this computer" onClick={() => void switchOutput('computer')}>
        <Icon name="laptop" size={15} />
        Computer
      </button>
    </div>
  )
}

export function PlayerBar() {
  const device = useStore((s) => s.snap.device)
  const now = useNowPlaying()
  const st = device.status
  const onComputer = now.output === 'computer'
  let title = now.title || ''
  let artist = now.artist || ''
  if (!now.title) {
    if (onComputer) {
      title = 'Ready'
      artist = 'Pick a song to play on this computer'
    } else if (!device.connected) {
      title = 'Nothing playing'
      artist = 'Connect your Z0Ɛ via USB, or listen on the computer'
    } else if (st.mode === 'wifi') {
      title = 'Wi-Fi mode'
      artist = 'Switch to music mode to listen on the Z0Ɛ'
    } else {
      title = 'Ready'
      artist = st.bt?.state === 'connected' ? 'Pick a song to play' : 'Connect headphones under Player'
    }
  }
  const usable = onComputer || device.connected
  return (
    <footer className={`player ${usable ? '' : 'off'}`}>
      <div className="now">
        <Cover track={now.track} size="lg" />
        <div className="meta">
          <div className="title">{title}</div>
          <div className="artist">{artist}</div>
        </div>
      </div>
      <div className="transport">
        <div className="ctl">
          <IconButton icon="shuffle" title="Shuffle" on={now.shuffle} onClick={() => controls.shuffle(!now.shuffle)} />
          <IconButton icon="prev" title="Previous" onClick={controls.prev} />
          <button className="play-btn" title="Play / pause" onClick={controls.toggle}>
            <Icon name={now.playing ? 'pause' : 'play'} size={20} />
          </button>
          <IconButton icon="next" title="Next" onClick={controls.next} />
          <button className={`icon-btn ${now.repeat ? 'on' : ''}`} title={['Repeat off', 'Repeat all', 'Repeat one'][now.repeat]} onClick={() => controls.repeat(((now.repeat + 1) % 3) as 0 | 1 | 2)}>
            <Icon name="repeat" />
            {now.repeat === 2 && <span className="badge">1</span>}
          </button>
        </div>
        <Progress pos={now.pos} dur={now.dur} live={now.live} statusAt={now.statusAt} />
      </div>
      <div className="right">
        <OutputSwitch />
        <Icon name="vol" />
        <Volume value={now.vol} />
      </div>
    </footer>
  )
}