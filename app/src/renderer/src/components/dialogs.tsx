import { useState } from 'react'
import type { Playlist, Track } from '@shared/types'
import { Button, Dialog } from './ui'
import { call, coverUrl, useStore } from '../store'

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
  const options = useStore((s) => s.snap.tracks.filter((t) => !p.tracks.includes(t.id) && !t.deviceOnly))
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
  const join = async () => {
    if (!ssid.trim()) return
    const ok = await call('wifi:set', ssid.trim(), locked ? pass : '')
    close()
    if (ok) useStore.getState().toast(mode === 'wifi' ? `Joining ${ssid}…` : `Saved. Switch to Wi-Fi mode to use ${ssid}.`)
  }
  return (
    <Dialog title={manual ? 'Wi-Fi network' : `Join “${initial}”`} actions={<><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={join}>{manual ? 'Save' : 'Join'}</Button></>}>
      {manual && (
        <>
          <label>Network name</label>
          <input className="field" autoFocus value={ssid} onChange={(e) => setSsid(e.target.value)} />
        </>
      )}
      {locked ? (
        <>
          <label>Password</label>
          <input className="field" type="password" autoFocus={!manual} value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && join()} />
        </>
      ) : (
        <p className="lead">This is an open network.</p>
      )}
      <p className="note">2.4 GHz networks only. The password is stored on the player.</p>
    </Dialog>
  )
}
export const wifiDialog = (ssid: string, locked: boolean, manual = false) => useStore.getState().openDialog(<Wifi ssid={ssid} locked={locked} manual={manual} />)