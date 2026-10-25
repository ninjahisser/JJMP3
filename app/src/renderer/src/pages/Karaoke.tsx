import { useEffect, useRef, useState } from 'react'
import { Empty } from '../components/ui'
import { Cover } from '../components/TrackRow'
import { useNowPlaying } from '../playback'

interface Lyrics {
  found: boolean
  synced: boolean
  lines: { t: number; text: string }[]
  plain: string | null
  offset?: number
}

interface Hit {
  lrclibId: number
  title: string
  artist: string
  album: string
  duration: number
  synced: boolean
}

/** Synced lyrics that follow whatever is playing, on the player or on this computer. */
export function Karaoke() {
  const now = useNowPlaying()
  const track = now.track
  const [lyrics, setLyrics] = useState<Lyrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const [finder, setFinder] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [, tick] = useState(0)
  const current = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 150)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setLyrics(null)
    setFinder(false)
    setHits(null)
    setQuery(`${track?.artist?.split(',')[0] ?? ''} ${track?.title ?? ''}`.trim())
    if (!track?.id) return
    let alive = true
    setLoading(true)
    window.jjmp3
      .invoke<Lyrics>('lyrics:get', track.id)
      .then((l) => {
        if (!alive) return
        setLyrics(l)
        setOffset(l.offset ?? 0)
      })
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
  for (let i = 0; i < lines.length; i++) if (lines[i].t + offset <= pos + 0.15) idx = i
  const synced = !!lyrics?.synced

  // live search: runs shortly after each keystroke while the finder is open
  useEffect(() => {
    if (!finder) return
    const q = query.trim()
    if (!q) {
      setHits(null)
      return
    }
    let alive = true
    setSearching(true)
    const t = setTimeout(() => {
      window.jjmp3
        .invoke<Hit[]>('lyrics:search', q)
        .then((h) => alive && setHits(h))
        .catch(() => alive && setHits([]))
        .finally(() => alive && setSearching(false))
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [finder, query])

  useEffect(() => {
    current.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [idx])

  const nudge = (d: number | null) => {
    const v = d === null ? 0 : Math.round((offset + d) * 10) / 10
    setOffset(v)
    if (track?.id) void window.jjmp3.invoke('lyrics:offset', track.id, v)
  }

  if (!track) return <Empty title="Nothing playing.">Play a song and its lyrics show up here.</Empty>

  const pick = async (h: Hit) => {
    setLoading(true)
    try {
      const l = await window.jjmp3.invoke<Lyrics>('lyrics:pick', track.id, h.lrclibId)
      setLyrics(l)
      setOffset(l.offset ?? 0)
      setFinder(false)
    } finally {
      setLoading(false)
    }
  }

  const finderUi = (
    <div className="card wide lyrics-finder">
      <div className="lyrics-search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a song title or artist" autoFocus />
        {searching && <span className="muted mono">…</span>}
      </div>
      {hits && hits.length === 0 && !searching && <p className="muted">Nothing found. Try fewer words, or just the song title.</p>}
      {hits && hits.length > 0 && (
        <div className="lyrics-hits">
          {hits.map((h) => (
            <button key={h.lrclibId} className="lyrics-hit" onClick={() => void pick(h)}>
              <span>
                <b>{h.title}</b> <span className="muted">{h.artist}{h.album ? ` · ${h.album}` : ''}</span>
              </span>
              <span className="mono muted">{h.synced ? 'synced' : 'text only'} · {Math.floor(h.duration / 60)}:{String(Math.round(h.duration % 60)).padStart(2, '0')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

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
        <button className="btn small ghost" onClick={() => setFinder((f) => !f)}>{finder ? 'Close search' : 'Wrong or missing lyrics? Search'}</button>
      </div>
      {finder && finderUi}
      {synced && (
        <div className="timing">
          <span className="eyebrow flat">Lyrics timing</span>
          <button className="btn small ghost" onClick={() => nudge(-0.5)}>−0.5</button>
          <button className="btn small ghost" onClick={() => nudge(-0.1)}>−0.1</button>
          <span className="mono timing-val">{offset > 0 ? '+' : ''}{offset.toFixed(1)} s</span>
          <button className="btn small ghost" onClick={() => nudge(0.1)}>+0.1</button>
          <button className="btn small ghost" onClick={() => nudge(0.5)}>+0.5</button>
          <button className="btn small ghost" onClick={() => nudge(null)} disabled={offset === 0}>Reset</button>
        </div>
      )}
      {loading && <div className="lookup-bar"><i /></div>}
      {!loading && lyrics && !lyrics.found && <Empty title="No lyrics found.">lrclib.net has nothing under this title. Use "Wrong or missing lyrics? Search" above to look for it yourself.</Empty>}
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
