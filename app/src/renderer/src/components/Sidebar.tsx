import { Icon } from './Icon'
import { Oled } from './Oled'
import { Activity } from './Activity'
import { Dot } from './ui'
import { useState } from 'react'
import { THEMES } from '@shared/themes'
import { applyTheme, call, plural, themePreview, useStore, type Page } from '../store'

function Nav({ label, page, count }: { label: string; page: Page; count?: number }) {
  const current = useStore((s) => s.page)
  const go = useStore((s) => s.go)
  const active = current.name === page.name || (page.name === 'playlists' && current.name === 'playlist')
  return (
    <a className={active ? 'active' : ''} onClick={() => go(page)}>
      <span>{label}</span>
      <span className="mono">{count || ''}</span>
    </a>
  )
}

/** "Themes" at the bottom: hover to open the list, hover a name to preview it, click to keep it. */
function ThemeMenu() {
  const { theme, palette } = useStore((s) => s.snap)
  const [open, setOpen] = useState(false)
  const close = () => {
    themePreview.on = false
    setOpen(false)
    applyTheme(theme, palette) // back to the saved one unless something was clicked
  }
  return (
    <div
      className="side-foot themes-menu"
      onMouseEnter={() => {
        themePreview.on = true
        setOpen(true)
      }}
      onMouseLeave={close}
    >
      {open && (
        <div className="themes-list">
          {(['light', 'dark'] as const).map((mode) => (
            <div key={mode}>
              <div className="eyebrow">{mode}</div>
              {THEMES.filter((t) => t.mode === mode).map((t) => (
                <a
                  key={`${t.palette}-${t.mode}`}
                  className={theme === t.mode && palette === t.palette ? 'on' : ''}
                  onMouseEnter={() => applyTheme(t.mode, t.palette)}
                  onClick={() => {
                    applyTheme(t.mode, t.palette)
                    void call('appearance:set', t.palette, t.mode)
                  }}
                >
                  {t.name}
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
      <span className="themes-label">Themes</span>
    </div>
  )
}

export function Sidebar() {
  const { device, tracks, playlists } = useStore((s) => s.snap)
  const st = device.status
  const sending = tracks.filter((t) => t.uploading != null).length
  const onPlayer = tracks.filter((t) => t.onDevice || t.deviceOnly).length
  const bt = st.bt
  const w = st.wifi

  return (
    <aside>
      <div className="brand">
        <h1>Z0Ɛ</h1>
      </div>
      <Oled />
      <div className="conn">
        {device.connected ? (
          <>
            <div className="row">
              <Dot kind="on" />
              <span>
                <b>Connected</b> · {device.via === 'usb' ? 'USB' : 'Wi-Fi'} {device.where}
              </span>
            </div>
            <div className="row">
              <Icon name="bt" />
              {st.mode === 'wifi' ? (
                <span className="muted">Bluetooth off in Wi-Fi mode</span>
              ) : bt?.state === 'connected' ? (
                <b>{bt.name}</b>
              ) : (
                <span>{bt?.state === 'refused' ? <span className="err-text">Re-pair {bt.name}</span> : bt?.name ? `${bt.state} · ${bt.name}` : 'No headphones yet'}</span>
              )}
            </div>
            <div className="row">
              <Icon name="wifi" />
              {st.mode === 'wifi' ? (
                <span>{w?.state === 'connected' ? <><b>{w.ssid}</b> · Wi-Fi mode</> : `Joining ${w?.ssid}…`}</span>
              ) : (
                <span>{w?.ssid ? <>{w.ssid} <span className="muted">· off while listening</span></> : 'Wi-Fi not set up'}</span>
              )}
            </div>
            {st.battery && (
              <div className="row">
                <Icon name="battery" />
                <span className="battery-row">
                  <span className={`battery ${st.battery.pct <= 15 ? 'low' : ''}`}>
                    <i style={{ width: `${st.battery.pct}%` }} />
                  </span>
                  <b>{st.battery.pct}%</b> <span className="muted mono">{st.battery.v.toFixed(2)} V</span>
                </span>
              </div>
            )}
            <div className="row">
              <Icon name="music" />
              {sending ? (
                <span>
                  <Dot kind="busy" /> Sending {plural(sending, 'song')}…
                </span>
              ) : (
                <span>{plural(onPlayer, 'song')} on the player</span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <Dot />
              <b>Not connected</b>
            </div>
            <div className="row muted">Plug the player in with USB, or keep it on the same Wi-Fi.</div>
          </>
        )}
      </div>
      <nav>
        <Nav label="Library" page={{ name: 'library' }} count={tracks.length} />
        <Nav label="Playlists" page={{ name: 'playlists' }} count={playlists.length} />
        <Nav label="Spotify" page={{ name: 'spotify' }} />
        <Nav label="Karaoke" page={{ name: 'karaoke' }} />
        <Nav label="Games" page={{ name: 'games' }} />
        <Nav label="Player" page={{ name: 'player' }} />
      </nav>
      <Activity />
      <ThemeMenu />
    </aside>
  )
}