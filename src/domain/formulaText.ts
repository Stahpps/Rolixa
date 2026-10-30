import { createFormula, DICE_TYPES, makeId, type DiceType, type Formula } from './dice'

export type FormulaTextResult =
  | { ok: true; formula: Formula }
  | { ok: false; error: string }

export function parseFormulaText(input: string): FormulaTextResult {
  if (input.length > 512) return { ok: false, error: 'Formula text must be 512 characters or fewer.' }
  const text = input.replace(/\s+/g, '').replace(/[−–]/g, '-')
  if (!text) return { ok: false, error: 'Paste a formula first.' }

  const terms: Formula['terms'] = []
  let position = 0
  while (position < text.length) {
    if (terms.length >= 100) return { ok: false, error: 'A formula can contain up to 100 terms.' }
    let sign: 1 | -1 = 1
    const operator = text[position]
    if (operator === '+' || operator === '-') {
      sign = operator === '-' ? -1 : 1
      position++
    } else if (terms.length > 0) {
      return { ok: false, error: 'Add a + or − sign between terms.' }
    }

    const remaining = text.slice(position)
    const diceMatch = remaining.match(/^(\d*)[dD](\d+)/)
    if (diceMatch) {
      const quantity = diceMatch[1] ? Number(diceMatch[1]) : 1
      const sides = Number(diceMatch[2])
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return { ok: false, error: 'Dice quantity must be between 1 and 100.' }
      if (!DICE_TYPES.includes(sides as DiceType)) return { ok: false, error: `D${sides} is not supported.` }
      terms.push({ id: makeId(), kind: 'dice', sides: sides as DiceType, quantity, sign })
      position += diceMatch[0].length
    } else {
      const modifierMatch = remaining.match(/^\d+/)
      if (!modifierMatch) return { ok: false, error: 'Use dice such as 2D6 and whole-number modifiers separated by + or −.' }
      const amount = Number(modifierMatch[0])
      if (!Number.isSafeInteger(amount) || amount > 1_000_000) return { ok: false, error: 'Modifiers must be whole numbers up to 1,000,000.' }
      terms.push({ id: makeId(), kind: 'modifier', value: amount * sign })
      position += modifierMatch[0].length
    }

    if (position < text.length && text[position] !== '+' && text[position] !== '-') {
      return { ok: false, error: 'Add a + or − sign between terms.' }
    }
  }

  return { ok: true, formula: createFormula(terms) }
}
