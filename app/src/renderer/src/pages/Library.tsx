import { useState } from 'react'
import type { Job } from '@shared/types'
import { Icon } from '../components/Icon'
import { TrackRow } from '../components/TrackRow'
import { Button, Dot, Empty } from '../components/ui'
import { call, fmtLong, plural, useStore } from '../store'

const LABELS: Record<string, string> = {
  resolving: 'Reading link', queued: 'Waiting', matching: 'Finding audio', downloading: 'Downloading',
  converting: 'Converting', artwork: 'Artwork', done: 'Added', error: 'Failed', skipped: 'Already added'
}
const finished = (j: Job) => ['done', 'error', 'skipped'].includes(j.state)

function JobRow({ j }: { j: Job }) {
  const busy = !finished(j)
  return (
    <div className="job">
      <div className="t">
        {j.title}
        {j.artist && <span className="muted"> · {j.artist}</span>}
      </div>
      <div className={`s mono ${j.state === 'error' ? 'err' : j.state === 'done' ? 'done' : ''}`}>
        {busy && <Dot kind="busy" />}
        {LABELS[j.state] || j.state}
        {j.state === 'downloading' && ` ${Math.round(j.progress * 100)}%`}
      </div>
      {j.state === 'error' && j.error && <div className="e">{j.error}</div>}
      {busy && <div className="bar" style={{ width: `${Math.round(j.progress * 100)}%` }} />}
    </div>
  )
}

export function Library() {
  const { tracks, jobs } = useStore((s) => s.snap)
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const toast = useStore((s) => s.toast)
  const [url, setUrl] = useState('')
  const total = tracks.reduce((a, t) => a + (t.duration || 0), 0)
  const q = filter.toLowerCase()
  const list = tracks.filter((t) => !q || `${t.title} ${t.artist}`.toLowerCase().includes(q))

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    if (await call('import', url.trim())) {
      setUrl('')
      toast('Looking up that link…')
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <div className="eyebrow">Your music</div>
          <h2>Library</h2>
          <div className="sub mono">
            {plural(tracks.length, 'song')}
            {total ? ` · ${fmtLong(total)}` : ''}
          </div>
        </div>
      </div>
      <form className="import" onSubmit={add}>
        <Icon name="link" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube or Spotify link…" autoComplete="off" spellCheck={false} />
        <Button type="submit" icon="plus">
          Add
        </Button>
      </form>
      <div className="import-hint">
        <span>
          <b>Songs, albums & playlists</b> work from both.
        </span>
        <span>Albums and playlists become a playlist here too.</span>
      </div>
      {jobs.length > 0 && (
        <div className="jobs">
          <header>
            <span className="eyebrow flat">Importing</span>
            <Button small variant="ghost" onClick={() => void call('jobs:clear')}>
              Clear finished
            </Button>
          </header>
          {jobs.map((j) => (
            <JobRow key={j.id} j={j} />
          ))}
        </div>
      )}
      {tracks.length ? (
        <>
          <div className="list-tools">
            <span className="eyebrow flat">All songs</span>
            <label className="search">
              <Icon name="search" />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" />
            </label>
          </div>
          <div className="tracks">
            {list.map((t, i) => (
              <TrackRow key={t.id} t={t} index={i} />
            ))}
          </div>
        </>
      ) : (
        <Empty title="A blank page.">Paste a link above. Your first song will be on the player in about a minute.</Empty>
      )}
    </>
  )
}