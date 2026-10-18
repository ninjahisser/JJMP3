import { useRef, useState } from 'react'
import type { Playlist } from '@shared/types'
import { Icon } from '../components/Icon'
import { play, TrackRow } from '../components/TrackRow'
import { newPlaylistDialog, pickSongsDialog } from '../components/dialogs'
import { Button, Empty, IconButton } from '../components/ui'
import { call, coverUrl, fmtLong, plural, useStore } from '../store'
import { playList } from '../playback'

function Mosaic({ p }: { p: Playlist }) {
  const tracks = useStore((s) => s.snap.tracks)
  const covers = p.tracks.map((id) => tracks.find((t) => t.id === id)).filter((t) => t?.cover).slice(0, 4)
  if (!covers.length)
    return (
      <div className="mosaic one">
        <div className="blank">{(p.name[0] || '·').toUpperCase()}</div>
      </div>
    )
  const shown = covers.length < 4 ? covers.slice(0, 1) : covers
  return (
    <div className={`mosaic ${shown.length === 1 ? 'one' : ''}`}>
      {shown.map((t) => (
        <div key={t!.id} style={{ backgroundImage: `url("${coverUrl(t)}")` }} />
      ))}
    </div>
  )
}

export function Playlists() {
  const playlists = useStore((s) => s.snap.playlists)
  const go = useStore((s) => s.go)
  return (
    <>
      <div className="head">
        <div>
          <div className="eyebrow">Collections</div>
          <h2>Playlists</h2>
          <div className="sub mono">{plural(playlists.length, 'playlist')}</div>
        </div>
        <Button icon="plus" onClick={() => newPlaylistDialog()}>
          New playlist
        </Button>
      </div>
      <div className="grid">
        {playlists.map((p) => (
          <div key={p.id} className="pl-card" onClick={() => go({ name: 'playlist', id: p.id })}>
            <Mosaic p={p} />
            <h4>{p.name}</h4>
            <div className="mono">{plural(p.tracks.length, 'song')}</div>
          </div>
        ))}
        <div className="pl-card new" onClick={() => newPlaylistDialog()}>
          <div>
            <Icon name="plus" />
            <div className="new-label">New playlist</div>
          </div>
        </div>
      </div>
    </>
  )
}

export function PlaylistPage({ id }: { id: string }) {
  const p = useStore((s) => s.snap.playlists.find((x) => x.id === id))
  const all = useStore((s) => s.snap.tracks)
  const go = useStore((s) => s.go)
  const openMenu = useStore((s) => s.openMenu)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  if (!p)
    return (
      <>
        <button className="back" onClick={() => go({ name: 'playlists' })}>
          <Icon name="back" />
          Playlists
        </button>
        <Empty title="Not found." />
      </>
    )

  const tracks = p.tracks.map((tid) => all.find((t) => t.id === tid)).filter(Boolean) as typeof all
  const total = tracks.reduce((a, t) => a + (t.duration || 0), 0)
  const start = (shuffle: boolean) => playList(p.id, shuffle)
  const rename = () => {
    const name = titleRef.current?.textContent?.trim()
    if (name && name !== p.name) void call('playlist:update', p.id, { name })
  }
  const drop = (target: string) => {
    if (!dragId || dragId === target) return
    const order = p.tracks.filter((t) => t !== dragId)
    order.splice(order.indexOf(target), 0, dragId)
    void call('playlist:update', p.id, { tracks: order })
  }

  return (
    <>
      <button className="back" onClick={() => go({ name: 'playlists' })}>
        <Icon name="back" />
        Playlists
      </button>
      <div className="head">
        <div className="grow">
          <div className="eyebrow">Playlist</div>
          <h2
            className="pl-title"
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLElement).blur()
              }
            }}
          >
            {p.name}
          </h2>
          <div className="sub mono">
            {plural(tracks.length, 'song')}
            {total ? ` · ${fmtLong(total)}` : ''}
          </div>
        </div>
        <div className="actions">
          <Button icon="play" disabled={!tracks.length} onClick={() => void start(false)}>
            Play
          </Button>
          <Button icon="shuffle" variant="ghost" disabled={!tracks.length} onClick={() => void start(true)}>
            Shuffle
          </Button>
          <IconButton
            icon="dots"
            title="More"
            onClick={(e) =>
              openMenu(e.currentTarget, [
                {
                  label: 'Delete playlist',
                  icon: 'trash',
                  danger: true,
                  onClick: async () => {
                    if (!confirm(`Delete the playlist “${p.name}”? The songs stay in your library.`)) return
                    await call('playlist:remove', p.id)
                    go({ name: 'playlists' })
                  }
                }
              ])
            }
          />
        </div>
      </div>
      <div className="list-tools">
        <span className="eyebrow flat">Drag to reorder</span>
        <Button small variant="ghost" icon="plus" onClick={() => pickSongsDialog(p)}>
          Add songs
        </Button>
      </div>
      <div className="tracks">
        {tracks.length === 0 && <Empty title="Empty for now.">Add songs from your library, or paste a playlist link on the Library page.</Empty>}
        {tracks.map((t, i) => (
          <TrackRow
            key={t.id}
            t={t}
            index={i}
            playlistId={p.id}
            draggable
            onTakeOut={() => void call('playlist:update', p.id, { tracks: p.tracks.filter((x) => x !== t.id) })}
            dragProps={{
              className: `${dragId === t.id ? 'dragging' : ''} ${overId === t.id ? 'drop-before' : ''}`,
              onDragStart: () => setDragId(t.id),
              onDragEnd: () => {
                setDragId(null)
                setOverId(null)
              },
              onDragOver: (e) => {
                e.preventDefault()
                setOverId(t.id)
              },
              onDrop: (e) => {
                e.preventDefault()
                setOverId(null)
                drop(t.id)
              }
            }}
          />
        ))}
      </div>
      {tracks.length > 0 && (
        <p className="note">
          Double-click a song to play the playlist from there. <a onClick={() => play(tracks[0].id, p.id)}>Play from the top</a>
        </p>
      )}
    </>
  )
}