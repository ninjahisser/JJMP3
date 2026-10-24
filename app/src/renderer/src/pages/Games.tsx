import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Button, Empty } from '../components/ui'
import { call, plural, useStore } from '../store'

interface Game {
  name: string
  size: number
}

export function Games() {
  const toast = useStore((s) => s.toast)
  const connected = useStore((s) => s.snap.device.connected)
  const [games, setGames] = useState<Game[] | null>(null)
  const refresh = async () => setGames((await call<Game[]>('games:list')) ?? [])
  useEffect(() => {
    if (connected) void refresh()
  }, [connected])

  return (
    <>
      <div className="head">
        <div>
          <div className="eyebrow">On the player</div>
          <h2>Games</h2>
          <div className="sub mono">{games ? plural(games.length + 2, 'game') : ''}</div>
        </div>
        <label className="btn file-btn">
          <Icon name="plus" size={17} />
          Add a CHIP-8 game
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
      </div>
      {!connected ? (
        <Empty title="Not connected.">Plug the player in to see and add its games.</Empty>
      ) : (
        <div className="tracks">
          {['Pibble Catch', 'Snake'].map((name) => (
            <div className="game-row" key={name}>
              <Icon name="gamepad" />
              <span className="nm">{name}</span>
              <span className="mono muted">built in</span>
            </div>
          ))}
          {games?.map((g) => (
            <div className="game-row" key={g.name}>
              <Icon name="gamepad" />
              <span className="nm">{g.name.replace(/\.ch8$/i, '')}</span>
              <span className="mono muted">CHIP-8 · {(g.size / 1024).toFixed(1)} KB</span>
              <Button
                small
                variant="danger"
                onClick={async () => {
                  if (confirm(`Take ${g.name} off the player?`) && (await call('games:remove', g.name)) !== undefined) void refresh()
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
