export type DiceType = 4 | 6 | 8 | 10 | 12 | 20 | 100
export type Sign = 1 | -1

export interface DiceTerm {
  id: string
  kind: 'dice'
  sides: DiceType
  quantity: number
  sign: Sign
}

export interface ModifierTerm {
  id: string
  kind: 'modifier'
  value: number
}

export type FormulaTerm = DiceTerm | ModifierTerm

export interface Formula {
  id: string
  terms: FormulaTerm[]
}

export interface TermResult {
  termId: string
  kind: FormulaTerm['kind']
  sides?: DiceType
  sign: Sign
  values: number[]
  subtotal: number
}

export interface RollResult {
  id: string
  formula: Formula
  termResults: TermResult[]
  total: number
  timestamp: number
  mode: 'quick' | 'formula'
}

export interface SavedFormula {
  id: string
  name: string
  formula: Formula
  favorite: boolean
  createdAt: number
  updatedAt: number
}

export const DICE_TYPES: readonly DiceType[] = [4, 6, 8, 10, 12, 20, 100]

export const DICE_COLORS: Record<DiceType, string> = {
  4: '#E85D5D',
  6: '#E9A23B',
  8: '#20A89A',
  10: '#4285D4',
  12: '#9563D8',
  20: '#65B741',
  100: '#D65D9E',
}

export function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createFormula(terms: FormulaTerm[] = []): Formula {
  return { id: makeId(), terms: terms.map((term) => ({ ...term })) }
}

export function cloneFormula(formula: Formula): Formula {
  return createFormula(formula.terms)
}

function secureRandomIndex(length: number): number {
  if (!Number.isSafeInteger(length) || length < 1 || length > 0xffffffff) {
    throw new RangeError('Dice range must be a positive integer.')
  }

  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.getRandomValues) return Math.floor(Math.random() * length)

  const range = 0x100000000
  const limit = Math.floor(range / length) * length
  const buffer = new Uint32Array(1)
  let value = 0
  do {
    cryptoApi.getRandomValues(buffer)
    value = buffer[0]!
  } while (value >= limit)
  return value % length
}

export function rollDie(sides: DiceType): number {
  return secureRandomIndex(sides) + 1
}

export function appendDie(terms: FormulaTerm[], sides: DiceType, sign: Sign): FormulaTerm[] {
  const next = terms.map((term) => ({ ...term }))
  const last = next.at(-1)
  if (last?.kind === 'dice' && last.sides === sides && last.sign === sign) {
    if (last.quantity >= 100) return next
    last.quantity += 1
  } else {
    next.push({ id: makeId(), kind: 'dice', sides, quantity: 1, sign })
  }
  return next
}

export function formatFormula(terms: FormulaTerm[], emptyLabel = 'Choose dice below'): string {
  if (!terms.length) return emptyLabel
  return terms.map((term, index) => {
    const negative = term.kind === 'dice' ? term.sign < 0 : term.value < 0
    const amount = term.kind === 'dice'
      ? `${term.quantity}D${term.sides}`
      : String(Math.abs(term.value))
    const sign = negative ? '−' : '+'
    return index === 0 && !negative ? amount : `${sign} ${amount}`
  }).join(' ')
}

export function evaluateFormula(formula: Formula, mode: RollResult['mode'] = 'formula'): RollResult {
  if (!formula.terms.length) throw new Error('Add at least one die or modifier first.')
  const termResults: TermResult[] = formula.terms.map((term) => {
    if (term.kind === 'modifier') {
      return {
        termId: term.id,
        kind: 'modifier',
        sign: term.value < 0 ? -1 : 1,
        values: [],
        subtotal: term.value,
      }
    }

    if (term.quantity < 1 || term.quantity > 100) throw new Error('Each dice group must contain between 1 and 100 dice.')
    const values = Array.from({ length: term.quantity }, () => rollDie(term.sides))
    const subtotal = values.reduce((sum, value) => sum + value, 0) * term.sign
    return { termId: term.id, kind: 'dice', sides: term.sides, sign: term.sign, values, subtotal }
  })

  return {
    id: makeId(),
    formula: cloneFormula(formula),
    termResults,
    total: termResults.reduce((sum, result) => sum + result.subtotal, 0),
    timestamp: Date.now(),
    mode,
  }
}

export function evaluateQuickRoll(sides: DiceType): RollResult {
  const formula = createFormula([{ id: makeId(), kind: 'dice', sides, quantity: 1, sign: 1 }])
  return evaluateFormula(formula, 'quick')
}
