import { Icon } from './Icon'
import { Oled } from './Oled'
import { Activity } from './Activity'
import { Dot } from './ui'
import { applyTheme, call, plural, useStore, type Page } from '../store'

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

export function Sidebar() {
  const { device, tracks, playlists, theme } = useStore((s) => s.snap)
  const st = device.status
  const sending = tracks.filter((t) => t.uploading != null).length
  const onPlayer = tracks.filter((t) => t.onDevice || t.deviceOnly).length
  const bt = st.bt
  const w = st.wifi

  return (
    <aside>
      <div className="brand">
        <h1>JJMP3</h1>
        <span className="mono">pocket player</span>
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
        <Nav label="Player" page={{ name: 'player' }} />
      </nav>
      <Activity />
      <div className="side-foot">
        <button
          className="theme-switch"
          role="switch"
          aria-checked={theme === 'dark'}
          onClick={() => {
            const next = theme === 'dark' ? 'light' : 'dark'
            applyTheme(next)
            void call('theme:set', next)
          }}
        >
          <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={16} />
          <span>Dark mode</span>
          <span className={`toggle ${theme === 'dark' ? 'on' : ''}`}>
            <i />
          </span>
        </button>
      </div>
    </aside>
  )
}