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
            ? 'Adding music and control work without a cable. Bluetooth audio is off.'
            : 'Bluetooth audio is on. Wi-Fi is off, because this chip has room for only one of the two.'}
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

interface Game {
  name: string
  size: number
}

function Games() {
  const toast = useStore((s) => s.toast)
  const connected = useStore((s) => s.snap.device.connected)
  const [games, setGames] = useState<Game[] | null>(null)
  const refresh = async () => setGames((await call<Game[]>('games:list')) ?? [])
  useEffect(() => {
    if (connected) void refresh()
  }, [connected])
  return (
    <div className="card">
      <h3>
        <Icon name="gamepad" /> Games
      </h3>
      <p className="lead">
        Pibble Catch and Snake are built in. Add CHIP-8 games (<span className="mono">.ch8</span> files) and they show up under Games on the player.
      </p>
      <div className="picklist">
        {games === null && <div className="note">Reading the card…</div>}
        {games?.length === 0 && <div className="note">No CHIP-8 games on the card yet.</div>}
        {games?.map((g) => (
          <div className="pick" key={g.name}>
            <Icon name="gamepad" />
            <span className="nm">{g.name.replace(/\.ch8$/i, '')}</span>
            <span className="mono muted">{(g.size / 1024).toFixed(1)} KB</span>
            <Button
              small
              variant="danger"
              onClick={async () => {
                if (confirm(`Take ${g.name} off the player?`) && (await call('games:remove', g.name) !== undefined)) void refresh()
              }}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
      <label className="btn ghost file-btn">
        <Icon name="plus" size={17} />
        Add a game
        <input
          type="file"
          accept=".ch8"
          multiple
          hidden
          onChange={async (e) => {
            for (const file of Array.from(e.target.files || [])) {
              const data = new Uint8Array(await file.arrayBuffer())
              if ((await call('games:add', file.name, data)) !== undefined) toast(`${file.name} is on the player`)
            }
            e.target.value = ''
            void refresh()
          }}
        />
      </label>
      <p className="note">Play: Games on the player. ‹ › and P are the game's keys 4, 6 and 5, – + are 8 and 2. Hold P to quit.</p>
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
    bt?.state === 'connected' ? (
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
            <Games />
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