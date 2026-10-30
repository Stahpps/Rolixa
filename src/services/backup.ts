import { DICE_TYPES, type DiceType, type Formula, type FormulaTerm, type RollResult, type SavedFormula, type Sign } from '../domain/dice'
import type { AppSettings, PersistedAppState } from './storage'

export interface RolixaBackup {
  app: 'Rolixa'
  formatVersion: 1
  exportedAt: string
  state: PersistedAppState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSign(value: unknown): value is Sign {
  return value === 1 || value === -1
}

function isDiceType(value: unknown): value is DiceType {
  return DICE_TYPES.includes(value as DiceType)
}

function isFormulaTerm(value: unknown): value is FormulaTerm {
  if (!isRecord(value) || typeof value.id !== 'string') return false
  if (value.kind === 'dice') {
    return isDiceType(value.sides) && Number.isInteger(value.quantity) && Number(value.quantity) >= 1 && Number(value.quantity) <= 100 && isSign(value.sign)
  }
  return value.kind === 'modifier' && Number.isSafeInteger(value.value) && Math.abs(Number(value.value)) <= 1_000_000
}

function isFormula(value: unknown): value is Formula {
  return isRecord(value) && typeof value.id === 'string' && Array.isArray(value.terms) && value.terms.every(isFormulaTerm)
}

function isRollResult(value: unknown): value is RollResult {
  if (!isRecord(value) || typeof value.id !== 'string' || !isFormula(value.formula) || !Array.isArray(value.termResults)) return false
  if (!Number.isSafeInteger(value.total) || !Number.isFinite(value.timestamp) || (value.mode !== 'quick' && value.mode !== 'formula')) return false
  return value.termResults.every((term) => {
    if (!isRecord(term) || typeof term.termId !== 'string' || !isSign(term.sign) || !Number.isSafeInteger(term.subtotal) || !Array.isArray(term.values)) return false
    if (term.kind === 'modifier') return term.values.length === 0
    return term.kind === 'dice' && isDiceType(term.sides) && term.values.every((face) => Number.isInteger(face) && Number(face) >= 1 && Number(face) <= Number(term.sides))
  })
}

function isSavedFormula(value: unknown): value is SavedFormula {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' && isFormula(value.formula)
    && typeof value.favorite === 'boolean' && Number.isFinite(value.createdAt) && Number.isFinite(value.updatedAt)
}

function isSettings(value: unknown): value is AppSettings {
  return isRecord(value)
    && (value.darkMode === null || typeof value.darkMode === 'boolean')
    && typeof value.haptics === 'boolean'
    && typeof value.largeDieNumbers === 'boolean'
    && (value.animationMode === 'dice2d' || value.animationMode === 'shuffle' || value.animationMode === 'none')
    && (value.animationSpeed === 'slow' || value.animationSpeed === 'medium' || value.animationSpeed === 'fast')
}

export function parseRolixaBackup(value: unknown): PersistedAppState | null {
  if (!isRecord(value) || value.app !== 'Rolixa' || value.formatVersion !== 1 || !isRecord(value.state)) return null
  const state = value.state
  if (state.schemaVersion !== 1 || !isRecord(state.draft) || !isFormula(state.draft.formula)) return null
  if ((state.draft.mode !== 'quick' && state.draft.mode !== 'formula') || !isSign(state.draft.activeSign)) return null
  if (!Array.isArray(state.savedFormulas) || state.savedFormulas.length > 1000 || !state.savedFormulas.every(isSavedFormula)) return null
  if (!Array.isArray(state.history) || state.history.length > 500 || !state.history.every(isRollResult) || !isSettings(state.settings)) return null
  return state as unknown as PersistedAppState
}
