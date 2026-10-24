import { useMemo, useState } from 'react'
import type { Playlist, Track } from '@shared/types'
import { Button, Dialog } from './ui'
import { call, coverUrl, fmt, fmtLong, plural, useStore } from '../store'

const close = () => useStore.getState().closeDialog()

function EditTrack({ t }: { t: Track }) {
  const [title, setTitle] = useState(t.title)
  const [artist, setArtist] = useState(t.artist)
  const save = async () => {
    await call('track:edit', t.id, { title, artist })
    close()
  }
  return (
    <Dialog title="Edit details" actions={<><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <label>Title</label>
      <input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      <label>Artist</label>
      <input className="field" value={artist} onChange={(e) => setArtist(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
    </Dialog>
  )
}
export const editTrackDialog = (t: Track) => useStore.getState().openDialog(<EditTrack t={t} />)

function NewPlaylist({ tracks }: { tracks: string[] }) {
  const [name, setName] = useState('')
  const create = async () => {
    const p = await call<Playlist>('playlist:create', name || 'Untitled', tracks)
    close()
    if (p) useStore.getState().go({ name: 'playlist', id: p.id })
  }
  return (
    <Dialog title="New playlist" actions={<><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={create}>Create</Button></>}>
      <label>Name</label>
      <input className="field" autoFocus placeholder="Late nights" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
    </Dialog>
  )
}
export const newPlaylistDialog = (tracks: string[] = []) => useStore.getState().openDialog(<NewPlaylist tracks={tracks} />)

function PickSongs({ p }: { p: Playlist }) {
  const tracks = useStore((s) => s.snap.tracks)
  const options = useMemo(() => tracks.filter((t) => !p.tracks.includes(t.id) && !t.deviceOnly), [tracks, p.tracks])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])))
  const add = async () => {
    await call('playlist:update', p.id, { tracks: [...p.tracks, ...options.filter((t) => picked.has(t.id)).map((t) => t.id)] })
    close()
  }
  return (
    <Dialog title="Add songs" actions={<><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={add} disabled={!picked.size}>Add {picked.size || ''}</Button></>}>
      <div className="picklist">
        {options.length === 0 && <div className="note">Everything is already in this playlist.</div>}
        {options.map((t) => {
          const url = coverUrl(t)
          return (
            <label className="pick" key={t.id}>
              <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />
              <div className="cover sm" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
              <span className="nm">
                {t.title} <span className="muted">· {t.artist}</span>
              </span>
            </label>
          )
        })}
      </div>
    </Dialog>
  )
}
export const pickSongsDialog = (p: Playlist) => useStore.getState().openDialog(<PickSongs p={p} />)

function Wifi({ ssid: initial, locked, manual }: { ssid: string; locked: boolean; manual: boolean }) {
  const [ssid, setSsid] = useState(initial)
  const [pass, setPass] = useState('')
  const mode = useStore((s) => s.snap.device.status.mode)
  const toast = useStore((s) => s.toast)
  const save = async (andSwitch: boolean) => {
    const name = ssid.trim()
    if (!name) return
    if (!(await call('wifi:set', name, locked ? pass : ''))) return
    close()
    if (mode === 'wifi') return toast(`Joining ${name}…`)
    if (andSwitch && (await call('mode:switch'))) return toast(`Saved. Switching to Wi-Fi mode to join ${name}…`)
    toast(`Saved ${name}. It's used when the player is in Wi-Fi mode.`)
  }
  const inMusic = mode !== 'wifi'
  return (
    <Dialog
      title={manual ? 'Wi-Fi network' : `Join “${initial}”`}
      actions={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          {inMusic && <Button variant="ghost" onClick={() => void save(false)}>Just save</Button>}
          <Button onClick={() => void save(inMusic)}>{inMusic ? 'Save and switch to Wi-Fi mode' : 'Join'}</Button>
        </>
      }
    >
      {manual && (
        <>
          <label>Network name</label>
          <input className="field" autoFocus value={ssid} onChange={(e) => setSsid(e.target.value)} />
        </>
      )}
      {locked ? (
        <>
          <label>Password</label>
          <input className="field" type="password" autoFocus={!manual} value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save(inMusic)} />
        </>
      ) : (
        <p className="lead">This is an open network.</p>
      )}
      <p className="note">
        2.4 GHz networks only. {inMusic ? 'The player keeps Wi-Fi off while it plays music, so it joins once you switch to Wi-Fi mode (it restarts, about 3 seconds).' : 'The password is stored on the player.'}
      </p>
    </Dialog>
  )
}
export const wifiDialog = (ssid: string, locked: boolean, manual = false) => useStore.getState().openDialog(<Wifi ssid={ssid} locked={locked} manual={manual} />)
interface PreviewItem {
  key: string
  id: string
  title: string
  artist: string
  duration: number
  thumb?: string | null
  source: 'youtube' | 'spotify'
  inLibrary: boolean
}

/** Paste a link or type a song name, see the results, tick what you want, then add. Nothing downloads before you confirm. */
function AddSongs() {
  const [query, setQuery] = useState('')
  const [looking, setLooking] = useState(false)
  const [preview, setPreview] = useState<{ name: string | null; items: PreviewItem[]; search: boolean } | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const toast = useStore((s) => s.toast)

  const lookUp = async (text = query) => {
    text = text.trim()
    if (!text) return
    setLooking(true)
    setError('')
    try {
      const r = await window.jjmp3.invoke<{ name: string | null; items: PreviewItem[]; search: boolean }>('preview', text)
      setPreview(r)
      // links: everything new is ticked; search results: nothing, you choose
      setPicked(new Set(r.search ? [] : r.items.filter((i) => !i.inLibrary).map((i) => i.key)))
    } catch (e) {
      setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setLooking(false)
    }
  }

  const toggle = (key: string) => setPicked((s) => (s.has(key) ? new Set([...s].filter((k) => k !== key)) : new Set([...s, key])))

  if (!preview)
    return (
      <Dialog
        title="Add music"
        actions={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={() => void lookUp()} disabled={looking || !query.trim()}>{looking ? 'Looking up…' : 'Look up'}</Button>
          </>
        }
      >
        <label>Song name, or a YouTube / Spotify link</label>
        <input
          className="field"
          autoFocus
          placeholder="Tame Impala The Less I Know The Better"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            if (/^https?:\/\//.test(text.trim())) {
              e.preventDefault()
              setQuery(text.trim())
              void lookUp(text)
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && void lookUp()}
        />
        {looking && <div className="lookup-bar"><i /></div>}
        {error && <p className="note err-text">{error}</p>}
      </Dialog>
    )

  const chosen = preview.items.filter((i) => picked.has(i.key))
  const total = chosen.reduce((a, i) => a + (i.duration || 0), 0)
  const single = !preview.search && preview.items.length === 1 ? preview.items[0] : null
  const add = async () => {
    await call('import:items', chosen, chosen.length > 1 && !preview.search ? preview.name : null)
    close()
    toast(chosen.length === 1 ? `Adding “${chosen[0].title}”…` : `Adding ${chosen.length} songs…`)
  }
  const selectable = preview.items.filter((i) => !i.inLibrary)

  return (
    <Dialog
      title={single ? 'Add this song?' : preview.search ? 'Results' : preview.name || 'Add these songs?'}
      actions={
        <>
          <Button variant="ghost" onClick={() => setPreview(null)}>Back</Button>
          <Button onClick={() => void add()} disabled={!chosen.length}>
            {!chosen.length ? (selectable.length ? 'Pick a song' : 'Already in your library') : chosen.length === 1 ? 'Add song' : `Add ${chosen.length} songs`}
          </Button>
        </>
      }
    >
      <div className="add-preview">
        {single ? (
          <div className="pv-single">
            <div className="pv-cover" style={single.thumb ? { backgroundImage: `url("${single.thumb}")` } : undefined} />
            <div>
              <div className="pv-title">{single.title}</div>
              <div className="pv-artist">{single.artist || 'Unknown artist'}</div>
              <div className="mono muted">
                {fmt(single.duration)} · {single.source === 'spotify' ? 'Spotify, audio from YouTube' : 'YouTube'}
              </div>
              {single.inLibrary && <p className="note">Already in your library.</p>}
            </div>
          </div>
        ) : (
          <>
            <div className="pv-sum">
              <span className="mono muted">
                {plural(preview.items.length, 'song')}
                {total ? ` · ${fmtLong(total)} selected` : ''}
                {!preview.search && selectable.length > 1 ? ' · becomes a playlist' : ''}
              </span>
              {selectable.length > 1 && (
                <button className="link-btn" onClick={() => setPicked(picked.size === selectable.length ? new Set() : new Set(selectable.map((i) => i.key)))}>
                  {picked.size === selectable.length ? 'Select none' : 'Select all'}
                </button>
              )}
            </div>
            <div className="picklist pv-list">
              {preview.items.map((i) => (
                <label className={`pick ${i.inLibrary ? 'muted-row' : ''}`} key={i.key}>
                  <input type="checkbox" disabled={i.inLibrary} checked={picked.has(i.key)} onChange={() => toggle(i.key)} />
                  <div className="cover sm" style={i.thumb ? { backgroundImage: `url("${i.thumb}")` } : undefined} />
                  <span className="nm">
                    {i.title} <span className="muted">· {i.artist}</span>
                  </span>
                  <span className="mono muted">{i.inLibrary ? 'have it' : fmt(i.duration)}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
export const addSongsDialog = () => useStore.getState().openDialog(<AddSongs />)
