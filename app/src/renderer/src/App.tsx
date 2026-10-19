import { useEffect } from 'react'
import { DialogHost, MenuHost, Toasts } from './components/ui'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar } from './components/Sidebar'
import { TopProgress } from './components/Activity'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Library } from './pages/Library'
import { Playlists, PlaylistPage } from './pages/Playlists'
import { Player } from './pages/Player'
import { useStore } from './store'
import { controls } from './playback'

export function App() {
  const page = useStore((s) => s.page)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable], dialog')) return
      if (e.code === 'Space') {
        e.preventDefault()
        controls.toggle()
      }
      if (e.shiftKey && e.key === 'ArrowRight') controls.next()
      if (e.shiftKey && e.key === 'ArrowLeft') controls.prev()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  return (
    <>
      <div className="drag" />
      <TopProgress />
      <div className="app">
        <Sidebar />
        <main>
          <div className="page" key={page.name === 'playlist' ? page.id : page.name}>
            <ErrorBoundary onReset={() => useStore.getState().go({ name: 'library' })}>
              {page.name === 'library' && <Library />}
              {page.name === 'playlists' && <Playlists />}
              {page.name === 'playlist' && <PlaylistPage id={page.id} />}
              {page.name === 'player' && <Player />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <PlayerBar />
      <MenuHost />
      <ErrorBoundary onReset={() => useStore.getState().closeDialog()}>
        <DialogHost />
      </ErrorBoundary>
      <Toasts />
    </>
  )
}