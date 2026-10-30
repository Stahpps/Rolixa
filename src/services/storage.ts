import type { Formula, RollResult, SavedFormula, Sign } from '../domain/dice'

export type SavedMode = 'formula' | 'quick'

export interface AppSettings {
  /** null follows the operating system until the user chooses a theme. */
  darkMode: boolean | null
  haptics: boolean
  largeDieNumbers: boolean
  animationMode: 'dice2d' | 'shuffle' | 'none'
  animationSpeed: 'slow' | 'medium' | 'fast'
}

export interface PersistedAppState {
  schemaVersion: 1
  draft: {
    formula: Formula
    mode: SavedMode
    activeSign: Sign
  }
  savedFormulas: SavedFormula[]
  history: RollResult[]
  settings: AppSettings
}

const STORAGE_KEY = 'rolixa.data.v1'

export const DEFAULT_SETTINGS: AppSettings = {
  darkMode: null,
  haptics: true,
  largeDieNumbers: false,
  animationMode: 'dice2d',
  animationSpeed: 'medium',
}

export function readAppState(): Partial<PersistedAppState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PersistedAppState>
    if (value.schemaVersion !== 1) return null
    return value
  } catch {
    return null
  }
}

export function writeAppState(state: PersistedAppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Keep the dice roller usable when storage is disabled or full.
  }
}
