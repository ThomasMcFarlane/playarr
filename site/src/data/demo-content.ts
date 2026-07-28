/**
 * Entirely fictional catalogue used only to illustrate the UI on this
 * marketing site. None of these titles, artists or people are real, and none
 * of this is a screenshot of any actual Playarr installation — see
 * DemoScreen.astro. Poster art is a gradient, not an image, so there is
 * nothing here that could be mistaken for real cover art either.
 */
export type Tone = 'brand' | 'amber' | 'teal' | 'violet'

export interface DemoTitle {
  title: string
  meta: string
  tone: Tone
}

const TONES: readonly Tone[] = ['brand', 'amber', 'teal', 'violet']
const tone = (i: number): Tone => TONES[i % TONES.length]

export const DEMO_MOVIES: readonly DemoTitle[] = [
  { title: 'Crimson Horizon', meta: 'Action · 2024', tone: tone(0) },
  { title: 'The Long Static', meta: 'Thriller · 2022', tone: tone(1) },
  { title: 'Paper Constellations', meta: 'Drama · 2023', tone: tone(2) },
  { title: 'Nine Rivers', meta: 'Adventure · 2021', tone: tone(3) },
  { title: 'Glasshouse', meta: 'Sci-Fi · 2024', tone: tone(0) },
  { title: 'Low Tide Motel', meta: 'Mystery · 2020', tone: tone(1) },
  { title: 'The Quiet Engine', meta: 'Drama · 2023', tone: tone(2) },
  { title: 'Floodlight', meta: 'Action · 2019', tone: tone(3) },
  { title: 'Second Winter', meta: 'Romance · 2022', tone: tone(0) },
] as const

export const DEMO_ARTISTS: readonly DemoTitle[] = [
  { title: 'Marble Season', meta: 'Indie Rock', tone: tone(0) },
  { title: 'Nova Kestrel', meta: 'Electronic', tone: tone(1) },
  { title: 'The Late Signals', meta: 'Alt Rock', tone: tone(2) },
  { title: 'Coral & Iron', meta: 'Folk', tone: tone(3) },
  { title: 'Vantablack Radio', meta: 'Synthwave', tone: tone(0) },
  { title: 'Paper Lanterns', meta: 'Pop', tone: tone(1) },
] as const

export const DEMO_DETAIL = {
  title: 'Glasshouse',
  meta: 'Film · 2h 04m · 2024 · Sci-Fi, Drama',
  synopsis:
    'A station engineer discovers the colony she has spent a decade maintaining was never meant to be found.',
  chapters: 6,
  similar: DEMO_MOVIES.slice(3, 8),
  tone: 'brand' as Tone,
}

export const DEMO_PROFILES = [
  { name: 'Alex', tone: tone(0) as Tone },
  { name: 'Sam', tone: tone(2) as Tone },
]
