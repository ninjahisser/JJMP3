import { useEffect } from 'react'
import { DialogHost, MenuHost, Toasts } from './components/ui'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar } from './components/Sidebar'
import { Library } from './pages/Library'
import { Playlists, PlaylistPage } from './pages/Playlists'
import { Player } from './pages/Player'
import { call, useStore } from './store'

export function App() {
  const page = useStore((s) => s.page)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable], dialog')) return
      if (e.code === 'Space') {
        e.preventDefault()
        void call('control', 'toggle')
      }
      if (e.shiftKey && e.key === 'ArrowRight') void call('control', 'next')
      if (e.shiftKey && e.key === 'ArrowLeft') void call('control', 'prev')
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  return (
    <>
      <div className="drag" />
      <div className="app">
        <Sidebar />
        <main>
          <div className="page" key={page.name === 'playlist' ? page.id : page.name}>
            {page.name === 'library' && <Library />}
            {page.name === 'playlists' && <Playlists />}
            {page.name === 'playlist' && <PlaylistPage id={page.id} />}
            {page.name === 'player' && <Player />}
          </div>
        </main>
      </div>
      <PlayerBar />
      <MenuHost />
      <DialogHost />
      <Toasts />
    </>
  )
}