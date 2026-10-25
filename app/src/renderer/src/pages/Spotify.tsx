import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/ui'
import { call, fmt, useStore } from '../store'

/** Remote for whatever Spotify (or another player on this PC) is playing; mirrors it on the player's screen. */
export function Spotify() {
  const sp = useStore((s) => s.snap.spotify)
  const statusAt = useStore((s) => s.statusAt)
  const [, tick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [])

  let pos = sp.pos
  if (sp.playing) pos += (performance.now() - statusAt) / 1000
  pos = sp.dur ? Math.min(pos, sp.dur) : pos
  const control = (cmd: string) => void call('spotify:control', cmd)

  return (
    <>
      <div className="head">
        <div>
          <h2>Spotify</h2>
        </div>
        <button className="theme-switch fit" role="switch" aria-checked={sp.on} onClick={() => void call('spotify:set', !sp.on)}>
          <span>Spotify mode</span>
          <span className={`toggle ${sp.on ? 'on' : ''}`}>
            <i />
          </span>
        </button>
      </div>

      {!sp.on && (
        <div className="card wide">
          <h3>
            <Icon name="music" /> Control Spotify from here
          </h3>
          <p className="lead">
            Turn Spotify mode on and this page shows what Spotify is playing, with its cover, and buttons to pause and skip. The player's screen shows the same song, and its buttons control Spotify too.
          </p>
        </div>
      )}

      {sp.on && !sp.available && (
        <div className="empty">
          <h3>Nothing playing.</h3>Open Spotify and play a song.
        </div>
      )}

      {sp.on && sp.available && (
        <div className="spotify-now">
          <div className="spotify-cover" style={{ backgroundImage: `url("jjmp3://spotify/art?v=${sp.art}")` }}>
            <Icon name="music" size={48} />
          </div>
          <div className="spotify-info">
            <h3 className="spotify-title">{sp.title || 'Unknown'}</h3>
            <div className="spotify-artist">{sp.artist}</div>
            {sp.album && <div className="mono muted">{sp.album}</div>}
            <div className="seek spotify-seek">
              <span className="mono">{fmt(pos)}</span>
              <div
                className="rail"
                onClick={(e) => {
                  if (!sp.dur) return
                  const r = e.currentTarget.getBoundingClientRect()
                  control(`seek:${Math.round(((e.clientX - r.left) / r.width) * sp.dur)}`)
                }}
              >
                <div>
                  <i style={{ width: sp.dur ? `${(pos / sp.dur) * 100}%` : 0 }} />
                </div>
              </div>
              <span className="mono">{fmt(sp.dur)}</span>
            </div>
            <div className="ctl spotify-ctl">
              <IconButton icon="prev" title="Previous" onClick={() => control('prev')} />
              <button className="play-btn" title="Play / pause" onClick={() => control('toggle')}>
                <Icon name={sp.playing ? 'pause' : 'play'} size={20} />
              </button>
              <IconButton icon="next" title="Next" onClick={() => control('next')} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
