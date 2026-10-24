import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { wifiDialog } from '../components/dialogs'
import { Button, Dot, Signal } from '../components/ui'
import { call, useStore } from '../store'

interface Net {
  ssid: string
  rssi: number
  lock: boolean
}

function ModeCard() {
  const st = useStore((s) => s.snap.device.status)
  const toast = useStore((s) => s.toast)
  const wifi = st.mode === 'wifi'
  return (
    <div className="card wide mode-card">
      <div>
        <div className="eyebrow">Mode</div>
        <h3>
          <Icon name={wifi ? 'wifi' : 'music'} /> {wifi ? 'Wi-Fi mode' : 'Music mode'}
        </h3>
      <p className="lead">
        {wifi
          ? 'Adding music and control work without a cable.'
          : 'Bluetooth audio is on.'}
      </p>
      </div>
      <Button
        variant={wifi ? undefined : 'ghost'}
        disabled={!wifi && !st.wifi?.ssid}
        title={!wifi && !st.wifi?.ssid ? 'Set up a Wi-Fi network first' : undefined}
        onClick={async () => {
          if (await call('mode:switch')) toast(wifi ? 'Switching to music mode…' : 'Switching to Wi-Fi mode…')
        }}
      >
        {wifi ? 'Back to music mode' : 'Switch to Wi-Fi mode'}
      </Button>
    </div>
  )
}

function You() {
  const st = useStore((s) => s.snap.device.status)
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState(st.user ?? '')
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!dirty) setName(st.user ?? '')
  }, [st.user, dirty])
  const save = async () => {
    if ((await call('user:set', name.trim())) !== undefined) {
      setDirty(false)
      toast(name.trim() ? `Hi ${name.trim()}` : 'Name cleared')
    }
  }
  return (
    <div className="card">
      <h3>
        <Icon name="edit" /> Your name
      </h3>
      <p className="lead">The player says it on its start screen (I ♥ U …). Its clock follows this computer whenever they connect.</p>
      <div className="inline-form">
        <input className="field" placeholder="Your name" maxLength={20} value={name} onChange={(e) => (setName(e.target.value), setDirty(true))} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        <Button onClick={() => void save()} disabled={!dirty}>Save</Button>
      </div>
    </div>
  )
}

function Headphones() {
  const st = useStore((s) => s.snap.device.status)
  const toast = useStore((s) => s.toast)
  const bt = st.bt
  const [scanning, setScanning] = useState(false)
  const [found, setFound] = useState<{ name: string; rssi: number }[]>([])

  useEffect(() => {
    if (!scanning) return
    let alive = true
    const t = setInterval(async () => {
      const r = await window.jjmp3.invoke<{ devices: { name: string; rssi: number }[] }>('bt:devices').catch(() => null)
      if (alive && r) setFound(r.devices)
    }, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [scanning])

  const lead =
    bt?.state === 'refused' ? (
      <span className="err-text">
        <b>{bt.name}</b> keeps refusing the connection. Disconnect them from your phone or PC, put them in pairing mode, then click <b>Pair again</b> and pick them.
      </span>
    ) : bt?.state === 'connected, no audio' ? (
      <>Connected to <b>{bt.name}</b>, waiting for the audio channel…</>
    ) : bt?.state === 'connected' ? (
      <>Playing through <b>{bt.name}</b>.</>
    ) : bt?.name ? (
      <>Looking for <b>{bt.name}</b>. Turn it on and it connects by itself.</>
    ) : (
      'The player sends its sound to Bluetooth headphones or a speaker.'
    )

  return (
    <div className="card">
      <h3>
        <Icon name="bt" /> Headphones
      </h3>
      <p className="lead">
        {lead}
        {st.mode === 'wifi' && ' Bluetooth is off in Wi-Fi mode.'}
      </p>
      <div className="actions">
        <Button
          disabled={st.mode === 'wifi'}
          onClick={async () => {
            setFound([])
            if (await call('bt:scan')) setScanning(true)
          }}
        >
          {scanning ? (
            <>
              <Dot kind="busy" /> Searching…
            </>
          ) : bt?.state === 'refused' ? (
            'Pair again'
          ) : bt?.name ? (
            'Use other headphones'
          ) : (
            'Find headphones'
          )}
        </Button>
        {bt?.name && (
          <Button
            variant="danger"
            onClick={async () => {
              if (confirm('Forget these headphones?') && (await call('bt:forget'))) toast('Restarting the player…')
            }}
          >
            Forget
          </Button>
        )}
      </div>
      {!bt?.name && !scanning && (
        <ol className="steps">
          <li>Put your headphones or speaker in <b>pairing mode</b> (usually: hold the power or Bluetooth button until a light blinks).</li>
          <li>Click <b>Find headphones</b> and wait a few seconds.</li>
          <li>Click <b>Connect</b> next to their name. The player restarts once and connects by itself from then on.</li>
        </ol>
      )}
      {scanning && (
        <div className="picklist">
          {found.length === 0 && <div className="note"><Dot kind="busy" /> Searching… make sure they're blinking in pairing mode. Phones and laptops don't show up, only audio devices.</div>}
          {found.map((d) => (
            <div className="pick" key={d.name}>
              <Icon name="bt" />
              <span className="nm">{d.name}</span>
              <Signal rssi={d.rssi} />
              <Button
                small
                onClick={async () => {
                  setScanning(false)
                  if (await call('bt:connect', d.name)) toast(`Connecting to ${d.name}, the player restarts…`)
                }}
              >
                Connect
              </Button>
            </div>
          ))}
        </div>
      )}
      {bt?.name && bt.state !== 'connected' && bt.events?.length ? (
        <p className="note mono">Link: {bt.events.slice(-4).join('  ->  ')}</p>
      ) : null}
      <p className="note">You can also pair on the player itself: Settings, Bluetooth.</p>
    </div>
  )
}

function Wifi() {
  const st = useStore((s) => s.snap.device.status)
  const toast = useStore((s) => s.toast)
  const w = st.wifi
  const wifiMode = st.mode === 'wifi'
  const [nets, setNets] = useState<Net[] | null>(null)
  const [scanning, setScanning] = useState(false)

  const scan = async () => {
    setScanning(true)
    const r = await call<{ networks: Net[] }>('wifi:scan')
    setScanning(false)
    if (r) setNets(r.networks)
  }

  const lead =
    w?.state === 'connected' ? (
      <>On <b>{w.ssid}</b> · <span className="mono">{w.ip}</span></>
    ) : w?.state === 'connecting' ? (
      <>Trying to join <b>{w.ssid}</b>…</>
    ) : w?.state === 'failed' ? (
      <span className="err-text">Couldn't join <b>{w.ssid}</b>. Check the network name and password.</span>
    ) : w?.ssid ? (
      <>Saved network: <b>{w.ssid}</b>. The player joins it in Wi-Fi mode.</>
    ) : (
      'Join Wi-Fi to add music and control the player without a cable.'
    )

  return (
    <div className="card">
      <h3>
        <Icon name="wifi" /> Wi-Fi
      </h3>
      <p className="lead">{lead}</p>
      <div className="actions">
        {wifiMode ? (
          <Button variant={w?.state === 'connected' ? 'ghost' : undefined} onClick={scan}>
            {scanning ? (
              <>
                <Dot kind="busy" /> Scanning…
              </>
            ) : (
              'Choose network'
            )}
          </Button>
        ) : w?.ssid ? (
          <>
            <Button onClick={async () => { if (await call('mode:switch')) toast('Switching to Wi-Fi mode…') }}>Switch to Wi-Fi mode</Button>
            <Button variant="ghost" onClick={() => wifiDialog(w.ssid, true, true)}>Change network</Button>
          </>
        ) : (
          <Button onClick={() => wifiDialog('', true, true)}>Set up Wi-Fi</Button>
        )}
        {w?.ssid && (
          <Button variant="danger" onClick={() => void call('wifi:forget')}>
            Forget
          </Button>
        )}
      </div>
      {nets && (
        <div className="picklist">
          {nets.length === 0 && <div className="note">No networks found.</div>}
          {nets.map((n, i) => (
            <div className="pick" key={n.ssid + i}>
              <Icon name="wifi" />
              <span className="nm">{n.ssid}</span>
              {n.lock && <Icon name="lock" />}
              <Signal rssi={n.rssi} />
              <Button small variant="ghost" onClick={() => wifiDialog(n.ssid, n.lock)}>
                Join
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="note">2.4 GHz networks only.</p>
    </div>
  )
}

function About() {
  const device = useStore((s) => s.snap.device)
  const toast = useStore((s) => s.toast)
  const st = device.status
  const [sd, setSd] = useState<{ used: number; total: number } | null>(null)
  const [checking, setChecking] = useState(false)
  return (
    <div className="card wide">
      <h3>
        <Icon name="music" /> About this player
      </h3>
      <dl className="kv">
        <dt>Songs on card</dt>
        <dd>{st.tracks ?? '?'}</dd>
        <dt>Storage</dt>
        <dd>
          {sd ? (
            `${(sd.used / 1e9).toFixed(2)} GB of ${(sd.total / 1e9).toFixed(1)} GB used`
          ) : (
            <Button
              small
              variant="ghost"
              onClick={async () => {
                setChecking(true)
                const r = await call<{ used: number; total: number }>('sd')
                setChecking(false)
                if (r) setSd(r)
              }}
            >
              {checking ? 'Checking…' : 'Check'}
            </Button>
          )}
        </dd>
        <dt>Battery</dt>
        <dd>{st.battery ? `${st.battery.pct}% · ${st.battery.v.toFixed(2)} V` : 'None wired (USB power)'}</dd>
        <dt>Free memory</dt>
        <dd className="mono">{st.heap ? `${Math.round(st.heap / 1024)} KB` : '?'}</dd>
        <dt>Connection</dt>
        <dd>
          {device.via === 'usb' ? 'USB · ' : 'Wi-Fi · '}
          <span className="mono">{device.where}</span>
        </dd>
        <dt>Button</dt>
        <dd>Click play/pause · double-click next · hold previous · triple-click switch mode</dd>
      </dl>
      <div className="actions">
        <Button
          variant="ghost"
          icon="power"
          onClick={async () => {
            if (await call('reboot')) toast('Restarting the player…')
          }}
        >
          Restart player
        </Button>
      </div>
    </div>
  )
}

export function Player() {
  const device = useStore((s) => s.snap.device)
  return (
    <>
      <div className="head">
        <div>
          <div className="eyebrow">Hardware</div>
          <h2>Player</h2>
          {device.connected && (
            <div className="sub mono">
              JJMP3 firmware {device.info.fw || '?'} · connected by {device.via === 'usb' ? 'USB' : 'Wi-Fi'}
            </div>
          )}
        </div>
      </div>
      {device.connected ? (
        <>
          <ModeCard />
          <div className="cards">
            <Headphones />
            <Wifi />
            <You />
            <About />
          </div>
        </>
      ) : (
        <div className="card wide">
          <h3>
            <Icon name="usb" /> Not connected
          </h3>
          <p className="lead">Plug your JJMP3 into this computer with its USB cable. It's picked up automatically, no setup needed.</p>
          <p className="note">Once it's on Wi-Fi it also connects wirelessly, as long as it's on the same network as this computer.</p>
        </div>
      )}
    </>
  )
}