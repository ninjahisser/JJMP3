// Games live on the SD card in /games: CHIP-8 programs (.ch8), run by the player's OS.
import type { Device } from './device'

const SAFE = /^[A-Za-z0-9 _.()-]{1,40}\.ch8$/

export async function listGames(device: Device): Promise<{ name: string; size: number }[]> {
  const r = await device.call('ls', { path: '/games' })
  return ((r.files || []) as { name: string; size: number; dir: boolean }[])
    .filter((f) => !f.dir && f.name.toLowerCase().endsWith('.ch8'))
    .map((f) => ({ name: f.name, size: f.size }))
}

export async function addGame(device: Device, name: string, data: Uint8Array): Promise<void> {
  name = name.replace(/[^A-Za-z0-9 _.()-]/g, '_')
  if (!SAFE.test(name)) throw new Error('Games are CHIP-8 programs: a .ch8 file with a short name.')
  // Allow larger CHIP-8 programs (some homebrew are bigger); the player still runs them
  if (data.length > 0x10000) throw new Error('That file is too big.')
  await device.put(`/games/${name}`, Buffer.from(data))
}

export async function removeGame(device: Device, name: string): Promise<void> {
  if (!SAFE.test(name)) throw new Error('Not a game file.')
  await device.call('rm', { path: `/games/${name}` })
}
