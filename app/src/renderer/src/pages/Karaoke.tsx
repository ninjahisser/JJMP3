import { useEffect, useRef, useState } from 'react'
import { Empty } from '../components/ui'
import { Cover } from '../components/TrackRow'
import { useNowPlaying } from '../playback'

interface Lyrics {
  found: boolean
  synced: boolean
  lines: { t: number; text: string }[]
  plain: string | null
}

/** Synced lyrics that follow whatever is playing, on the player or on this computer. */
export function Karaoke() {
  const now = useNowPlaying()
  const track = now.track
  const [lyrics, setLyrics] = useState<Lyrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [, tick] = useState(0)
  const current = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 150)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setLyrics(null)
    if (!track?.id) return
    let alive = true
    setLoading(true)
    window.jjmp3
      .invoke<Lyrics>('lyrics:get', track.id)
      .then((l) => alive && setLyrics(l))
      .catch(() => alive && setLyrics({ found: false, synced: false, lines: [], plain: null }))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [track?.id])

  let pos = now.pos
  if (now.live) pos += (performance.now() - now.statusAt) / 1000
  const lines = lyrics?.lines ?? []
  let idx = -1
  for (let i = 0; i < lines.length; i++) if (lines[i].t <= pos + 0.15) idx = i
  const synced = !!lyrics?.synced

  useEffect(() => {
    current.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [idx])

  if (!track) return <Empty title="Nothing playing.">Play a song and its lyrics show up here.</Empty>

  return (
    <>
      <div className="head">
        <div className="karaoke-head">
          <Cover track={track} size="lg" />
          <div>
            <div className="eyebrow">Karaoke</div>
            <h2 className="karaoke-title">{track.title}</h2>
            <div className="sub mono">{track.artist || 'Unknown artist'}</div>
          </div>
        </div>
      </div>
      {loading && <div className="lookup-bar"><i /></div>}
      {!loading && lyrics && !lyrics.found && <Empty title="No lyrics found.">lrclib.net has nothing for this song.</Empty>}
      {!loading && lyrics?.found && !synced && <pre className="plain-lyrics">{lyrics.plain}</pre>}
      {synced && (
        <div className="lyrics">
          {lines.map((l, i) => (
            <div key={i} ref={i === idx ? current : undefined} className={`lyric ${i === idx ? 'now' : i < idx ? 'past' : ''}`}>
              {l.text || '♪'}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
