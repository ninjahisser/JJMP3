import type { Track } from '@shared/types'
import { Icon } from './Icon'
import { IconButton } from './ui'
import { call, coverUrl, fmt, useStore } from '../store'
import { editTrackDialog, newPlaylistDialog } from './dialogs'
import { playTrack, usePlayback } from '../playback'

export function Cover({ track, size }: { track?: Track; size?: 'lg' }) {
  const url = coverUrl(track)
  return (
    <div className={`cover ${size || ''}`} style={url ? { backgroundImage: `url("${url}")` } : undefined}>
      {!url && <Icon name="music" />}
    </div>
  )
}

function State({ t }: { t: Track }) {
  const connected = useStore((s) => s.snap.device.connected)
  if (t.uploading != null)
    return (
      <div className="state">
        <span className="prog">
          <i style={{ width: `${Math.round(t.uploading * 100)}%` }} />
        </span>
        <span className="mono">{Math.round(t.uploading * 100)}%</span>
      </div>
    )
  if (t.deviceOnly) return <div className="state"><span className="dot on" />Only on player</div>
  if (t.onDevice) return <div className="state"><span className="dot on" />On player</div>
  return <div className="state"><span className="dot" />{connected ? 'Queued' : 'Not sent yet'}</div>
}

export function play(trackId: string, playlistId?: string) {
  playTrack(trackId, playlistId)
}

export function trackMenu(t: Track, anchor: Element) {
  const s = useStore.getState()
  s.openMenu(anchor, [
    { label: 'Play', icon: 'play', onClick: () => play(t.id) },
    { separator: true, label: '' },
    { heading: true, label: 'Add to playlist' },
    ...s.snap.playlists.map((p) => ({
      label: p.name,
      icon: 'list',
      onClick: async () => {
        if (p.tracks.includes(t.id)) return s.toast(`Already in ${p.name}`)
        await call('playlist:update', p.id, { tracks: [...p.tracks, t.id] })
        s.toast(`Added to ${p.name}`)
      }
    })),
    { label: 'New playlist…', icon: 'plus', onClick: () => newPlaylistDialog([t.id]) },
    { separator: true, label: '' },
    ...(t.deviceOnly ? [] : [{ label: 'Edit details', icon: 'edit', onClick: () => editTrackDialog(t) }]),
    ...(t.url ? [{ label: 'Open source', icon: 'link', onClick: () => void call('open:url', t.url) }] : []),
    {
      label: 'Remove',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        if (!confirm(`Remove “${t.title}” from your library and the player?`)) return
        await call('track:remove', t.id)
        s.toast('Removed')
      }
    }
  ])
}

export function TrackRow({
  t,
  index,
  playlistId,
  onTakeOut,
  draggable,
  dragProps
}: {
  t: Track
  index: number
  playlistId?: string
  onTakeOut?: () => void
  draggable?: boolean
  dragProps?: React.HTMLAttributes<HTMLDivElement>
}) {
  const st = useStore((s) => s.snap.device.status)
  const pb = usePlayback()
  const onComputer = pb.output === 'computer'
  const playing = onComputer ? pb.trackId === t.id : st.track === t.id
  const audible = onComputer ? pb.playing : st.state === 'playing'
  return (
    <div {...dragProps} className={`track ${playing ? 'playing' : ''} ${dragProps?.className || ''}`} onDoubleClick={() => play(t.id, playlistId)} draggable={draggable}>
      <div className="n">
        {draggable ? (
          <span className="grip">
            <Icon name="grip" />
          </span>
        ) : playing ? (
          <span className={`eq ${audible ? '' : 'paused'}`}>
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="mono">{index + 1}</span>
        )}
        <IconButton
          icon="play"
          title="Play"
          onClick={(e) => {
            e.stopPropagation()
            play(t.id, playlistId)
          }}
        />
      </div>
      <Cover track={t} />
      <div className="meta">
        <div className="title">{t.title}</div>
        <div className="artist">{t.recovered && t.title === 'Untitled' ? 'Details lost. Paste its link again to restore them.' : t.artist || 'Unknown artist'}</div>
      </div>
      <State t={t} />
      <div className="dur mono">{fmt(t.duration)}</div>
      <IconButton
        icon={onTakeOut ? 'x' : 'dots'}
        title={onTakeOut ? 'Take out of playlist' : 'More'}
        onClick={(e) => {
          e.stopPropagation()
          if (onTakeOut) onTakeOut()
          else trackMenu(t, e.currentTarget)
        }}
      />
    </div>
  )
}