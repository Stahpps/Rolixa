<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Clipboard } from '@capacitor/clipboard'
import {
  appendDie,
  cloneFormula,
  createFormula,
  DICE_COLORS,
  DICE_TYPES,
  evaluateQuickRoll,
  evaluateFormula,
  formatFormula,
  makeId,
  rollDie,
  type DiceType,
  type Formula,
  type FormulaTerm,
  type RollResult,
  type SavedFormula,
  type Sign,
} from './domain/dice'
import { DEFAULT_SETTINGS, readAppState, writeAppState, type AppSettings, type PersistedAppState } from './services/storage'
import { parseRolixaBackup } from './services/backup'
import DiceGlyph from './components/DiceGlyph.vue'
import PolyDieRoll from './components/PolyDieRoll.vue'
import { parseFormulaText } from './domain/formulaText'

type Mode = 'formula' | 'quick'
type Drawer = 'saved' | 'history' | 'settings' | null
const mode = ref<Mode>('formula')
const formula = ref<Formula>(createFormula())
const activeSign = ref<Sign>(1)
const quickDie = ref<DiceType>(20)
const quickResult = ref<number | null>(null)
const lastRoll = ref<RollResult | null>(null)
const animatingRoll = ref<RollResult | null>(null)
const isRolling = ref(false)
const animationDigits = ref<Record<string, number>>({})
const quickAnimationFace = ref<number | null>(null)
const activeAnimationMode = ref<'dice2d' | 'shuffle' | 'none'>('none')
let animationRun = 0
const animationKeyRun = ref(0)
const history = ref<RollResult[]>([])
const savedFormulas = ref<SavedFormula[]>([])
const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS })
const systemDark = ref(true)
const drawer = ref<Drawer>(null)
const savedSearch = ref('')
const clearHistoryConfirm = ref(false)
const saveModal = ref<'save' | 'rename' | null>(null)
const saveName = ref('')
const saveTargetId = ref<string | null>(null)
const quickStageElement = ref<HTMLElement | null>(null)
const suppressQuickClickUntil = ref(0)
interface PointerGesture { pointerId: number; sides: DiceType; startX: number; startY: number; startAt: number; x: number; y: number; dragged: boolean }
const pointerGesture = ref<PointerGesture | null>(null)
const undoStack = ref<FormulaTerm[][]>([])
const selectedTermId = ref<string | null>(null)
const modifierOpen = ref(false)
const modifierSign = ref<Sign>(1)
const modifierInput = ref('1')
const rollAnnouncement = ref('')
const reducedMotion = ref(false)
const backupInput = ref<HTMLInputElement | null>(null)
const pendingBackup = ref<PersistedAppState | null>(null)
const backupMessage = ref('')
const backupError = ref(false)
const formulaTextModal = ref(false)
const formulaTextInput = ref('')
const formulaTextError = ref('')
const formulaTransferMessage = ref('')
const formulaPresets: { label: string; dice: { sides: DiceType; quantity: number }[] }[] = [
  { label: 'D20', dice: [{ sides: 20, quantity: 1 }] },
  { label: '2D6', dice: [{ sides: 6, quantity: 2 }] },
  { label: '3D6', dice: [{ sides: 6, quantity: 3 }] },
  { label: 'D100', dice: [{ sides: 100, quantity: 1 }] },
]

const formulaText = computed(() => formatFormula(formula.value.terms))
const displayedRoll = computed(() => animatingRoll.value ?? lastRoll.value)
const totalVisible = computed(() => displayedRoll.value?.total ?? null)
const isDark = computed(() => settings.value.darkMode ?? systemDark.value)
const filteredSavedFormulas = computed(() => {
  const query = savedSearch.value.trim().toLocaleLowerCase()
  return savedFormulas.value
    .filter((item) => !query || item.name.toLocaleLowerCase().includes(query) || formatFormula(item.formula.terms).toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt)
})

function persist() {
  const state: PersistedAppState = {
    schemaVersion: 1,
    draft: { formula: formula.value, mode: mode.value, activeSign: activeSign.value },
    savedFormulas: savedFormulas.value,
    history: history.value.slice(0, 500),
    settings: settings.value,
  }
  writeAppState(state)
}

onMounted(() => {
  reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  systemDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  const saved = readAppState()
  if (saved?.draft?.formula && Array.isArray(saved.draft.formula.terms)) formula.value = saved.draft.formula
  if (saved?.draft?.mode === 'formula' || saved?.draft?.mode === 'quick') mode.value = saved.draft.mode
  if (saved?.draft?.activeSign === 1 || saved?.draft?.activeSign === -1) activeSign.value = saved.draft.activeSign
  if (Array.isArray(saved?.savedFormulas)) savedFormulas.value = saved.savedFormulas
  if (Array.isArray(saved?.history)) history.value = saved.history.slice(0, 500)
  settings.value = { ...DEFAULT_SETTINGS, ...saved?.settings }
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
watch([formula, mode, activeSign, history, savedFormulas, settings], persist, { deep: true })

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    drawer.value = null
    modifierOpen.value = false
    saveModal.value = null
    selectedTermId.value = null
  }
}

function completeRoll(result: RollResult) {
  rollAnnouncement.value = `Rolled ${formatFormula(result.formula.terms)}. Total ${result.total}`
  history.value = [result, ...history.value].slice(0, 500)
  if (settings.value.haptics && 'vibrate' in navigator) navigator.vibrate?.(10)
}

function animationDuration(): number {
  return settings.value.animationSpeed === 'slow' ? 1200 : settings.value.animationSpeed === 'fast' ? 300 : 600
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function animationKey(termId: string, index: number) {
  return `${termId}:${index}`
}

async function presentRoll(result: RollResult, quickSides?: DiceType) {
  const run = ++animationRun
  animationKeyRun.value = run
  const animationMode = reducedMotion.value ? 'none' : settings.value.animationMode
  activeAnimationMode.value = animationMode
  const duration = animationDuration()
  lastRoll.value = null
  quickResult.value = null

  if (animationMode === 'none') {
    if (quickSides) quickResult.value = result.termResults[0]?.values[0] ?? null
    lastRoll.value = result
    completeRoll(result)
    return
  }

  isRolling.value = true
  animatingRoll.value = result
  animationDigits.value = {}
  if (quickSides) quickAnimationFace.value = Math.ceil(Math.random() * quickSides)
  else {
    for (const term of result.termResults) {
      if (term.kind !== 'dice' || !term.sides) continue
      term.values.forEach((value, index) => {
        animationDigits.value[animationKey(term.termId, index)] = Math.ceil(Math.random() * term.sides!)
      })
    }
  }
  await nextTick()

  if (animationMode === 'dice2d') {
    if (quickSides) {
      await wait(duration)
    } else {
      const faces = result.termResults.flatMap((term) => term.kind === 'dice'
        ? term.values.map((_, index) => wait(duration + Math.min(index * 24, 168)))
        : [])
      await Promise.all(faces)
    }
  } else if (quickSides) {
    const end = performance.now() + duration
    while (performance.now() < end && run === animationRun) {
      quickAnimationFace.value = Math.ceil(Math.random() * quickSides)
      await wait(38)
    }
    quickAnimationFace.value = result.termResults[0]?.values[0] ?? null
  } else {
    const faces = result.termResults.flatMap((term) => term.kind === 'dice' && term.sides
      ? term.values.map(async (finalValue, index) => {
        const key = animationKey(term.termId, index)
        await wait(Math.min(index * 24, 168))
        const end = performance.now() + duration
        while (performance.now() < end && run === animationRun) {
          animationDigits.value[key] = Math.ceil(Math.random() * term.sides!)
          await wait(38)
        }
        animationDigits.value[key] = finalValue
      })
      : [])
    await Promise.all(faces)
  }

  if (run !== animationRun) return
  lastRoll.value = result
  if (quickSides) quickResult.value = result.termResults[0]?.values[0] ?? null
  animatingRoll.value = null
  isRolling.value = false
  completeRoll(result)
}

function visibleDieValue(termId: string, index: number, actual: number) {
  return activeAnimationMode.value === 'shuffle' && isRolling.value
    ? animationDigits.value[animationKey(termId, index)] ?? actual
    : actual
}

function rememberFormula() {
  undoStack.value.push(formula.value.terms.map((term) => ({ ...term })))
  if (undoStack.value.length > 40) undoStack.value.shift()
  lastRoll.value = null
}

function addDie(sides: DiceType, sign = activeSign.value) {
  if (mode.value === 'quick') {
    quickDie.value = sides
    quickResult.value = rollDie(sides)
    lastRoll.value = null
    rollAnnouncement.value = `D${sides}: ${quickResult.value}`
    return
  }
  rememberFormula()
  formula.value = { ...formula.value, terms: appendDie(formula.value.terms, sides, sign) }
}

function setSign(sign: Sign) {
  activeSign.value = sign
}

function addModifier() {
  const parsed = Number(modifierInput.value)
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > 1000000) return
  rememberFormula()
  formula.value = {
    ...formula.value,
    terms: [...formula.value.terms, { id: makeId(), kind: 'modifier', value: Math.abs(parsed) * modifierSign.value }],
  }
  modifierOpen.value = false
}

function openModifier() {
  modifierInput.value = '1'
  modifierSign.value = 1
  modifierOpen.value = true
}

function updateTerm(action: 'decrement' | 'remove') {
  if (!selectedTermId.value) return
  const id = selectedTermId.value
  const term = formula.value.terms.find((item) => item.id === id)
  if (!term) return
  rememberFormula()
  if (action === 'remove' || term.kind === 'modifier' || term.quantity === 1) {
    formula.value = { ...formula.value, terms: formula.value.terms.filter((item) => item.id !== id) }
  } else {
    formula.value = {
      ...formula.value,
      terms: formula.value.terms.map((item) => item.id === id && item.kind === 'dice' ? { ...item, quantity: item.quantity - 1 } : item),
    }
  }
  selectedTermId.value = null
}

function undo() {
  const previous = undoStack.value.pop()
  if (!previous) return
  formula.value = { ...formula.value, terms: previous }
  lastRoll.value = null
}

function clearFormula() {
  if (!formula.value.terms.length) return
  rememberFormula()
  formula.value = createFormula()
}

function applyPreset(dice: { sides: DiceType; quantity: number }[]) {
  if (isRolling.value) return
  rememberFormula()
  formula.value = createFormula(dice.map(({ sides, quantity }) => ({ id: makeId(), kind: 'dice', sides, quantity, sign: 1 as Sign })))
}

async function copyFormulaText() {
  const text = formatFormula(formula.value.terms).replace(/[−–]/g, '-')
  try {
    await Clipboard.write({ string: text, label: 'Rolixa formula' })
    formulaTransferMessage.value = `Copied to clipboard: ${text}`
  } catch {
    formulaTransferMessage.value = 'Copy failed. Please try again.'
  }
}

function openFormulaTextModal() {
  formulaTextInput.value = ''
  formulaTextError.value = ''
  formulaTextModal.value = true
}

function loadFormulaText() {
  const parsed = parseFormulaText(formulaTextInput.value)
  if (!parsed.ok) {
    formulaTextError.value = parsed.error
    return
  }
  rememberFormula()
  formula.value = parsed.formula
  quickResult.value = null
  lastRoll.value = null
  selectedTermId.value = null
  formulaTextModal.value = false
  formulaTransferMessage.value = 'Formula loaded.'
}

async function rollFormula() {
  if (!formula.value.terms.length || isRolling.value) return
  try {
    const result = evaluateFormula(formula.value)
    await presentRoll(result)
  } catch (error) {
    rollAnnouncement.value = error instanceof Error ? error.message : 'Could not roll this formula.'
  }
}

async function rollQuickDie(sides: DiceType) {
  if (isRolling.value) return
  quickDie.value = sides
  const result = evaluateQuickRoll(sides)
  await presentRoll(result, sides)
}

function selectQuickDie(sides: DiceType) {
  if (Date.now() < suppressQuickClickUntil.value) return
  rollQuickDie(sides)
}

function pointerDown(event: PointerEvent, sides: DiceType) {
  if (event.button !== 0) return
  pointerGesture.value = {
    pointerId: event.pointerId,
    sides,
    startX: event.clientX,
    startY: event.clientY,
    startAt: performance.now(),
    x: event.clientX,
    y: event.clientY,
    dragged: false,
  }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function pointerMove(event: PointerEvent) {
  const gesture = pointerGesture.value
  if (!gesture || gesture.pointerId !== event.pointerId) return
  const dx = event.clientX - gesture.startX
  const dy = event.clientY - gesture.startY
  if (!gesture.dragged && Math.hypot(dx, dy) > 10) gesture.dragged = true
  gesture.x = event.clientX
  gesture.y = event.clientY
}

function pointerUp(event: PointerEvent) {
  const gesture = pointerGesture.value
  if (!gesture || gesture.pointerId !== event.pointerId) return
  const dx = event.clientX - gesture.startX
  const dy = event.clientY - gesture.startY
  const elapsed = Math.max(1, performance.now() - gesture.startAt)
  const speed = Math.hypot(dx, dy) / elapsed
  const stage = quickStageElement.value?.getBoundingClientRect()
  const droppedOnStage = Boolean(stage && event.clientX >= stage.left && event.clientX <= stage.right && event.clientY >= stage.top && event.clientY <= stage.bottom)
  const flickedTowardCenter = dy < -28 && speed > 0.55
  if (gesture.dragged) {
    suppressQuickClickUntil.value = Date.now() + 450
    if (droppedOnStage || flickedTowardCenter) rollQuickDie(gesture.sides)
  }
  pointerGesture.value = null
}

function cancelPointer(event: PointerEvent) {
  if (pointerGesture.value?.pointerId === event.pointerId) pointerGesture.value = null
}

function openDrawer(which: Exclude<Drawer, null>) {
  drawer.value = which
  clearHistoryConfirm.value = false
  selectedTermId.value = null
}

function closeDrawer() {
  drawer.value = null
  clearHistoryConfirm.value = false
}

function openSaveFormula() {
  if (!formula.value.terms.length) return
  saveName.value = ''
  saveTargetId.value = null
  saveModal.value = 'save'
}

function confirmSaveFormula() {
  const name = saveName.value.trim()
  if (!name) return
  const now = Date.now()
  if (saveModal.value === 'rename' && saveTargetId.value) {
    savedFormulas.value = savedFormulas.value.map((item) => item.id === saveTargetId.value ? { ...item, name, updatedAt: now } : item)
  } else {
    savedFormulas.value.unshift({ id: makeId(), name, formula: cloneFormula(formula.value), favorite: false, createdAt: now, updatedAt: now })
  }
  saveModal.value = null
}

function renameSaved(item: SavedFormula) {
  saveName.value = item.name
  saveTargetId.value = item.id
  saveModal.value = 'rename'
}

function duplicateSaved(item: SavedFormula) {
  const now = Date.now()
  savedFormulas.value.unshift({ id: makeId(), name: `${item.name} copy`, formula: cloneFormula(item.formula), favorite: false, createdAt: now, updatedAt: now })
}

function toggleFavorite(id: string) {
  savedFormulas.value = savedFormulas.value.map((item) => item.id === id ? { ...item, favorite: !item.favorite, updatedAt: Date.now() } : item)
}

function deleteSaved(id: string) {
  savedFormulas.value = savedFormulas.value.filter((item) => item.id !== id)
}

function loadFormula(value: Formula) {
  formula.value = cloneFormula(value)
  mode.value = 'formula'
  quickResult.value = null
  lastRoll.value = null
  undoStack.value = []
  selectedTermId.value = null
  closeDrawer()
}

function loadHistoryEntry(entry: RollResult) {
  loadFormula(entry.formula)
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

function setTheme(theme: 'system' | 'dark' | 'light') {
  settings.value = { ...settings.value, darkMode: theme === 'system' ? null : theme === 'dark' }
}

function exportBackup() {
  const backup = {
    app: 'Rolixa',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    state: {
      schemaVersion: 1,
      draft: { formula: cloneFormula(formula.value), mode: mode.value, activeSign: activeSign.value },
      savedFormulas: savedFormulas.value,
      history: history.value,
      settings: settings.value,
    },
  }
  const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = `rolixa-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  backupError.value = false
  backupMessage.value = 'Backup exported.'
}

function chooseBackupFile() {
  backupError.value = false
  backupMessage.value = ''
  backupInput.value?.click()
}

async function readBackupFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const backup = parseRolixaBackup(JSON.parse(await file.text()))
    if (!backup) throw new Error('This file is not a valid Rolixa backup.')
    pendingBackup.value = backup
    backupError.value = false
    backupMessage.value = ''
  } catch (error) {
    backupError.value = true
    backupMessage.value = error instanceof Error ? error.message : 'Could not read this backup file.'
  } finally {
    input.value = ''
  }
}

function restoreBackup() {
  const backup = pendingBackup.value
  if (!backup) return
  animationRun++
  isRolling.value = false
  animatingRoll.value = null
  formula.value = cloneFormula(backup.draft.formula)
  mode.value = backup.draft.mode
  activeSign.value = backup.draft.activeSign
  savedFormulas.value = backup.savedFormulas
  history.value = backup.history
  settings.value = { ...DEFAULT_SETTINGS, ...backup.settings }
  undoStack.value = []
  quickResult.value = null
  lastRoll.value = null
  clearHistoryConfirm.value = false
  pendingBackup.value = null
  backupError.value = false
  backupMessage.value = 'Backup restored.'
}

function showTermValue(term: FormulaTerm) {
  return term.kind === 'dice' ? `${term.quantity}D${term.sides}` : String(Math.abs(term.value))
}

function termSign(term: FormulaTerm): Sign {
  return term.kind === 'dice' ? term.sign : term.value < 0 ? -1 : 1
}

function dieStyle(sides: DiceType) {
  return { '--die-color': DICE_COLORS[sides] }
}

</script>

<template>
  <main class="app-shell" :class="{ 'reduce-motion': reducedMotion, 'large-die-results': settings.largeDieNumbers }" :data-theme="isDark ? 'dark' : 'light'">
    <header class="topbar">
      <button class="header-icon" aria-label="Open settings" @click="openDrawer('settings')">⚙</button>
      <div class="brand" aria-label="Rolixa by Stahpps">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span class="brand-name">ROLIXA</span>
      </div>
      <div class="brand-caption">by Stahpps</div>
    </header>

    <div class="tagline">Every roll. Your rules.</div>

    <nav class="mode-switch" aria-label="Roll mode">
      <button :disabled="isRolling" :class="{ active: mode === 'quick' }" @click="mode = 'quick'; lastRoll = null">Quick Roll</button>
      <button :disabled="isRolling" :class="{ active: mode === 'formula' }" @click="mode = 'formula'; quickResult = null">Formula Roll</button>
    </nav>

    <section ref="quickStageElement" class="roll-stage" :class="{ 'quick-stage': mode === 'quick' }" aria-live="polite">
      <template v-if="mode === 'formula'">
        <div class="formula-label">CURRENT FORMULA</div>
        <div class="formula-strip" role="group" aria-label="Current formula">
          <template v-if="formula.terms.length">
            <template v-for="(term, index) in formula.terms" :key="term.id">
              <span v-if="index > 0" class="operator" aria-hidden="true">{{ termSign(term) < 0 ? '−' : '+' }}</span>
              <button class="term-chip" :disabled="isRolling" :class="{ 'modifier-chip': term.kind === 'modifier' }" :style="term.kind === 'dice' ? dieStyle(term.sides) : undefined" :aria-label="`${termSign(term) < 0 ? 'minus' : 'plus'} ${showTermValue(term)}. Tap to edit`" @click="selectedTermId = selectedTermId === term.id ? null : term.id">
                <span v-if="index === 0 && termSign(term) < 0" class="chip-sign">−</span>
                {{ showTermValue(term) }}
              </button>
            </template>
          </template>
          <span v-else class="empty-formula">Choose dice below</span>
          <button class="mod-button" :disabled="isRolling" @click="openModifier">MOD</button>
        </div>
        <div class="formula-presets" aria-label="Formula presets">
          <span>PRESETS</span>
          <button v-for="preset in formulaPresets" :key="preset.label" :disabled="isRolling" @click="applyPreset(preset.dice)">{{ preset.label }}</button>
        </div>

        <div v-if="selectedTermId" class="term-menu" @click.stop>
          <span>Edit term</span>
          <button v-if="formula.terms.find(t => t.id === selectedTermId)?.kind === 'dice'" @click="updateTerm('decrement')">−1 die</button>
          <button class="danger-action" @click="updateTerm('remove')">Remove</button>
          <button class="close-menu" aria-label="Close term menu" @click="selectedTermId = null">×</button>
        </div>

        <div class="result-area" :class="{ 'has-result': displayedRoll }">
          <template v-if="displayedRoll">
            <div class="result-overline">{{ isRolling ? 'ROLLING' : 'TOTAL' }}</div>
            <div v-if="!isRolling" class="result-number">{{ totalVisible }}</div>
            <div class="result-breakdown">
              <div v-for="entry in displayedRoll.termResults" :key="entry.termId" class="breakdown-row">
                <span class="breakdown-term" :style="entry.sides ? { color: DICE_COLORS[entry.sides] } : undefined">
                  {{ entry.kind === 'dice' ? `${entry.sign < 0 ? '−' : ''}D${entry.sides}` : `${entry.sign < 0 ? '−' : '+'} MOD` }}
                </span>
                <span v-if="entry.kind === 'dice'" class="pip-values die-results">
                  <span v-for="(value, index) in entry.values" :key="index" class="die-result">
                    <PolyDieRoll v-if="settings.animationMode !== 'shuffle' && (!isRolling || activeAnimationMode === 'dice2d')" class="result-die" :sides="entry.sides ?? 6" :face="visibleDieValue(entry.termId, index, value)" :color="DICE_COLORS[entry.sides ?? 6]" :rolling="isRolling && activeAnimationMode === 'dice2d'" :roll-key="animationKeyRun" :duration-ms="animationDuration()" :delay-ms="Math.min(index * 24, 168)" />
                    <span v-else class="shuffle-result">{{ visibleDieValue(entry.termId, index, value) }}</span>
                    <small v-if="settings.animationMode !== 'shuffle'" class="die-result-label">{{ visibleDieValue(entry.termId, index, value) }}</small>
                  </span>
                </span>
                <span v-else class="pip-values">{{ Math.abs(entry.subtotal) }}</span>
                <span class="term-total">{{ entry.subtotal < 0 ? '−' : '+' }}{{ Math.abs(entry.subtotal) }}</span>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="result-placeholder" aria-hidden="true">
              <span class="placeholder-die">{{ quickResult ?? '—' }}</span>
              <span class="placeholder-caption">{{ formula.terms.length ? 'Ready when you are' : 'Your result will appear here' }}</span>
            </div>
          </template>
        </div>

        <div class="formula-actions">
          <button class="quiet-action" :disabled="!formula.terms.length || isRolling" @click="openSaveFormula">Save</button>
          <button class="quiet-action" :disabled="!undoStack.length || isRolling" @click="undo">Undo</button>
          <button class="quiet-action" :disabled="!formula.terms.length || isRolling" @click="clearFormula">Clear</button>
          <button class="quiet-action" :disabled="!formula.terms.length || isRolling" @click="copyFormulaText">Copy text</button>
          <button class="quiet-action formula-entry-action" :disabled="isRolling" @click="openFormulaTextModal">Type formula</button>
        </div>
        <div v-if="formulaTransferMessage" class="formula-transfer-message" role="status">{{ formulaTransferMessage }}</div>
      </template>

      <template v-else>
        <div class="quick-die" :style="dieStyle(quickDie)">
          <div class="quick-die-glyph" :class="{ 'quick-number-shuffle': settings.animationMode === 'shuffle' || (isRolling && activeAnimationMode === 'shuffle') }" aria-live="polite">
            <span class="quick-roll-token" :style="dieStyle(quickDie)">
              <PolyDieRoll v-if="settings.animationMode !== 'shuffle' && (!isRolling || activeAnimationMode === 'dice2d')" :key="quickDie" :sides="quickDie" :face="animatingRoll?.termResults[0]?.values[0] ?? quickResult" :color="DICE_COLORS[quickDie]" :rolling="isRolling && activeAnimationMode === 'dice2d'" :roll-key="animationKeyRun" :duration-ms="animationDuration()" />
              <span v-else class="quick-shuffle-number">{{ isRolling && activeAnimationMode === 'shuffle' ? quickAnimationFace : animatingRoll?.termResults[0]?.values[0] ?? quickResult ?? '—' }}</span>
            </span>
          </div>
          <div class="quick-die-name">{{ isRolling ? 'ROLLING' : quickResult === null ? 'Tap a die to roll' : `D${quickDie} RESULT` }}</div>
        </div>
      </template>
    </section>

    <section v-if="mode === 'quick'" class="quick-palette" aria-label="Choose a die to roll">
      <button v-for="sides in DICE_TYPES" :key="sides" class="quick-die-button" :style="dieStyle(sides)" aria-label="Tap, drag, or flick to roll this die" @click="selectQuickDie(sides)" @pointerdown="pointerDown($event, sides)" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelPointer">
        <span class="die-palette-icon"><DiceGlyph :sides="sides" decorative /></span>
        <span>D{{ sides }}</span>
      </button>
    </section>

    <footer class="bottom-controls">
      <button v-if="mode === 'formula'" class="roll-button" :disabled="!formula.terms.length || isRolling" @click="rollFormula">
        <span class="roll-symbol" aria-hidden="true">↻</span>
        ROLL
      </button>
      <div v-if="mode === 'formula'" class="sign-hint">Choose a sign, then add dice</div>
      <div v-if="mode === 'formula'" class="dice-palette" aria-label="Add dice to formula">
        <div v-for="sides in DICE_TYPES" :key="sides" class="dice-control" :style="dieStyle(sides)">
          <button class="sign-control" :disabled="isRolling" :aria-label="`Add a negative D${sides}`" @click="setSign(-1); addDie(sides, -1)">−</button>
          <button class="die-palette-button" :disabled="isRolling" :aria-label="`Add one D${sides} using ${activeSign < 0 ? 'negative' : 'positive'} sign`" @click="addDie(sides)">
            <span class="die-palette-icon"><DiceGlyph :sides="sides" decorative /></span>
            <span>D{{ sides }}</span>
          </button>
          <button class="sign-control" :disabled="isRolling" :aria-label="`Add a positive D${sides}`" @click="setSign(1); addDie(sides, 1)">+</button>
        </div>
      </div>
      <div v-else class="quick-footer-note">Choose a die to roll instantly</div>
      <div class="footer-brand">STAHPPS <span>·</span> JUST ENOUGH SOFTWARE</div>
    </footer>

    <button v-if="!drawer" class="edge-indicator edge-left" aria-label="Open saved formulas" @click="openDrawer('saved')"><span aria-hidden="true">▤</span><span>Saved</span></button>
    <button v-if="!drawer" class="edge-indicator edge-right" aria-label="Open roll history" @click="openDrawer('history')"><span aria-hidden="true">◷</span><span>History</span></button>
    <div v-if="pointerGesture?.dragged" class="drag-die" :style="{ left: pointerGesture.x + 'px', top: pointerGesture.y + 'px', '--die-color': DICE_COLORS[pointerGesture.sides] }" aria-hidden="true">
      <span class="die-palette-icon"><DiceGlyph :sides="pointerGesture.sides" decorative /></span><span>D{{ pointerGesture.sides }}</span>
    </div>

    <div v-if="drawer" class="drawer-backdrop" @click="closeDrawer">
      <aside v-if="drawer === 'saved'" class="side-drawer saved-drawer" role="dialog" aria-modal="true" aria-labelledby="saved-title" @click.stop>
        <div class="drawer-header"><div><span class="eyebrow">YOUR LIBRARY</span><h2 id="saved-title">Saved formulas</h2></div><button class="icon-button" aria-label="Close saved formulas" @click="closeDrawer">×</button></div>
        <p class="drawer-instruction">Tap a formula to load it into the roller.</p>
        <div class="drawer-toolbar"><input v-model="savedSearch" class="drawer-search" type="search" placeholder="Search name or formula" aria-label="Search saved formulas" /><button class="confirm-button compact-button" :disabled="!formula.terms.length" @click="closeDrawer(); openSaveFormula()">Save current</button></div>
        <div class="drawer-list">
          <article v-for="item in filteredSavedFormulas" :key="item.id" class="library-card">
            <button class="library-load" @click="loadFormula(item.formula)"><strong>{{ item.name }}</strong><span>{{ formatFormula(item.formula.terms) }}</span></button>
            <div class="library-meta"><span>Updated {{ formatDate(item.updatedAt) }}</span><div class="library-actions"><button :aria-label="item.favorite ? 'Remove favorite' : 'Add favorite'" :class="{ favorite: item.favorite }" @click="toggleFavorite(item.id)">{{ item.favorite ? '★' : '☆' }}</button><button aria-label="Rename formula" @click="renameSaved(item)">✎</button><button aria-label="Duplicate formula" @click="duplicateSaved(item)">⧉</button><button class="delete-action" aria-label="Delete formula" @click="deleteSaved(item.id)">×</button></div></div>
          </article>
          <div v-if="!filteredSavedFormulas.length" class="drawer-empty"><span aria-hidden="true">▤</span><p>{{ savedFormulas.length ? 'No formulas match your search.' : 'Save a formula to find it here later.' }}</p></div>
        </div>
      </aside>
      <aside v-else-if="drawer === 'history'" class="side-drawer history-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title" @click.stop>
        <div class="drawer-header"><div><span class="eyebrow">RECENT ROLLS</span><h2 id="history-title">Roll history</h2></div><button class="icon-button" aria-label="Close roll history" @click="closeDrawer">×</button></div>
        <p class="history-instruction">Tap a roll to load its formula into the roller.</p>
        <div class="history-subhead"><span>{{ history.length }} / 500 rolls</span><button class="text-danger" :disabled="!history.length" @click="clearHistoryConfirm = !clearHistoryConfirm">Clear history</button></div>
        <div v-if="clearHistoryConfirm" class="confirm-strip"><span>Clear all roll history?</span><button @click="history = []; clearHistoryConfirm = false">Clear</button><button @click="clearHistoryConfirm = false">Cancel</button></div>
        <div class="drawer-list history-list">
          <button v-for="entry in history" :key="entry.id" class="history-card" @click="loadHistoryEntry(entry)">
            <span class="history-main"><strong>{{ entry.total }}</strong><span>{{ formatFormula(entry.formula.terms) }}</span></span>
            <span v-if="entry.termResults?.length" class="history-breakdown" aria-label="Individual roll results">
              <span v-for="(term, termIndex) in entry.termResults" :key="term.termId" class="history-result-group">
                <span class="history-result-label" :style="term.sides ? { color: DICE_COLORS[term.sides] } : undefined">{{ term.kind === 'dice' ? `D${term.sides}` : 'MOD' }}</span>
                <template v-if="term.kind === 'dice'">
                  <span v-for="(value, dieIndex) in term.values" :key="dieIndex" class="history-die-value">{{ value }}</span>
                </template>
                <span v-else class="history-die-value">{{ term.subtotal }}</span>
                <span v-if="termIndex < entry.termResults.length - 1" class="history-breakdown-separator" aria-hidden="true">·</span>
              </span>
            </span>
            <span class="history-details"><span>{{ entry.mode === 'quick' ? 'Quick roll' : 'Formula roll' }}</span><time>{{ formatDate(entry.timestamp) }}</time></span>
          </button>
          <div v-if="!history.length" class="drawer-empty"><span aria-hidden="true">◷</span><p>Completed rolls will appear here.</p></div>
        </div>
      </aside>
      <aside v-else class="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title" @click.stop>
        <div class="drawer-header"><div><span class="eyebrow">PREFERENCES</span><h2 id="settings-title">Settings</h2></div><button class="icon-button" aria-label="Close settings" @click="closeDrawer">×</button></div>
        <section class="settings-section"><h3>Appearance</h3><p>Choose how Rolixa looks.</p><div class="segmented settings-segmented"><button :class="{ active: settings.darkMode === null }" @click="setTheme('system')">System</button><button :class="{ active: settings.darkMode === true }" @click="setTheme('dark')">Dark</button><button :class="{ active: settings.darkMode === false }" @click="setTheme('light')">Light</button></div></section>
        <section class="settings-section"><h3>Roll animation</h3><p>Choose how results settle.</p><div class="segmented settings-segmented"><button :class="{ active: settings.animationMode === 'dice2d' }" @click="settings = { ...settings, animationMode: 'dice2d' }">2D Dice</button><button :class="{ active: settings.animationMode === 'shuffle' }" @click="settings = { ...settings, animationMode: 'shuffle' }">Number Shuffle</button><button :class="{ active: settings.animationMode === 'none' }" @click="settings = { ...settings, animationMode: 'none' }">None</button></div></section>
        <section class="settings-section"><h3>Animation speed</h3><p>Applies to both roll modes.</p><div class="segmented settings-segmented"><button :disabled="settings.animationMode === 'none'" :class="{ active: settings.animationSpeed === 'slow' }" @click="settings = { ...settings, animationSpeed: 'slow' }">Slow</button><button :disabled="settings.animationMode === 'none'" :class="{ active: settings.animationSpeed === 'medium' }" @click="settings = { ...settings, animationSpeed: 'medium' }">Medium</button><button :disabled="settings.animationMode === 'none'" :class="{ active: settings.animationSpeed === 'fast' }" @click="settings = { ...settings, animationSpeed: 'fast' }">Fast</button></div></section>
        <section class="settings-section"><h3>Backup</h3><p>Save or restore your formulas, rolls, and preferences.</p><div class="backup-actions"><button class="backup-button" @click="exportBackup">Export backup</button><button class="backup-button" @click="chooseBackupFile">Import backup</button></div><input ref="backupInput" class="sr-only" type="file" accept=".json,application/json" aria-label="Choose a Rolixa backup file" @change="readBackupFile" /><p v-if="backupMessage" class="backup-message" :class="{ error: backupError }" role="status">{{ backupMessage }}</p></section>
        <section class="settings-section settings-row"><div><h3>Larger die result numbers</h3><p>Enlarge individual results, not the total.</p></div><button class="switch" role="switch" :aria-checked="settings.largeDieNumbers" :class="{ on: settings.largeDieNumbers }" @click="settings = { ...settings, largeDieNumbers: !settings.largeDieNumbers }"><span></span></button></section>
        <section class="settings-section settings-row"><div><h3>Haptic feedback</h3><p>Short vibration after a roll</p></div><button class="switch" role="switch" :aria-checked="settings.haptics" :class="{ on: settings.haptics }" @click="settings = { ...settings, haptics: !settings.haptics }"><span></span></button></section>
        <section class="kofi-card"><div><h3>Enjoying Rolixa?</h3><p>Support Stahpps and help keep the rolls coming.</p></div><a class="kofi-link" href="https://ko-fi.com/stahpps" target="_blank" rel="noopener noreferrer">Support on Ko-fi <span aria-hidden="true">↗</span></a></section>
        <div class="about-card"><span class="about-mark">R</span><div><strong>Rolixa</strong><span>Version 1.0 · Made by Stahpps</span></div></div>
        <p class="settings-footnote">Offline-first dice rolling.<br />Every roll. Your rules.</p>
      </aside>
    </div>

    <div v-if="modifierOpen" class="modal-backdrop" @click.self="modifierOpen = false">
      <section class="modifier-panel" role="dialog" aria-modal="true" aria-labelledby="modifier-title">
        <div class="panel-topline"><span class="eyebrow">FORMULA</span><button aria-label="Close" class="icon-button" @click="modifierOpen = false">×</button></div>
        <h2 id="modifier-title">Add modifier</h2>
        <div class="modifier-entry">
          <div class="sign-toggle" aria-label="Modifier sign">
            <button :class="{ selected: modifierSign === 1 }" @click="modifierSign = 1">+</button>
            <button :class="{ selected: modifierSign === -1 }" @click="modifierSign = -1">−</button>
          </div>
          <input v-model="modifierInput" inputmode="numeric" type="number" min="0" max="1000000" aria-label="Modifier amount" @keyup.enter="addModifier" />
        </div>
        <p class="panel-note">Enter a whole number up to 1,000,000.</p>
        <div class="panel-actions">
          <button class="quiet-action" @click="modifierOpen = false">Cancel</button>
          <button class="confirm-button" :disabled="!Number.isSafeInteger(Number(modifierInput)) || Math.abs(Number(modifierInput)) > 1000000" @click="addModifier">Add</button>
        </div>
      </section>
    </div>
    <div v-if="saveModal" class="modal-backdrop" @click.self="saveModal = null">
      <section class="modifier-panel" role="dialog" aria-modal="true" aria-labelledby="save-title">
        <div class="panel-topline"><span class="eyebrow">SAVED FORMULAS</span><button aria-label="Close" class="icon-button" @click="saveModal = null">×</button></div>
        <h2 id="save-title">{{ saveModal === 'rename' ? 'Rename formula' : 'Save formula' }}</h2>
        <div class="save-preview">{{ saveModal === 'rename' ? (savedFormulas.find(item => item.id === saveTargetId) ? formatFormula(savedFormulas.find(item => item.id === saveTargetId)!.formula.terms) : '') : formulaText }}</div>
        <input v-model="saveName" class="name-input" maxlength="48" placeholder="Give it a name" aria-label="Formula name" @keyup.enter="confirmSaveFormula" />
        <div class="panel-actions"><button class="quiet-action" @click="saveModal = null">Cancel</button><button class="confirm-button" :disabled="!saveName.trim()" @click="confirmSaveFormula">{{ saveModal === 'rename' ? 'Save name' : 'Save' }}</button></div>
      </section>
    </div>
    <div v-if="formulaTextModal" class="modal-backdrop" @click.self="formulaTextModal = false">
      <section class="modifier-panel" role="dialog" aria-modal="true" aria-labelledby="formula-text-title">
        <div class="panel-topline"><span class="eyebrow">FORMULA TEXT</span><button aria-label="Close" class="icon-button" @click="formulaTextModal = false">×</button></div>
        <h2 id="formula-text-title">Enter formula</h2>
        <p class="panel-note">Type or paste dice and modifiers, for example 2D6 + D20 - 3. No dice bar needed.</p>
        <textarea v-model="formulaTextInput" class="formula-text-input" rows="3" maxlength="512" placeholder="2D6 + D20 - 3" aria-label="Formula text" @keyup.ctrl.enter="loadFormulaText" @keyup.meta.enter="loadFormulaText"></textarea>
        <p v-if="formulaTextError" class="formula-text-error" role="alert">{{ formulaTextError }}</p>
        <div class="panel-actions"><button class="quiet-action" @click="formulaTextModal = false">Cancel</button><button class="confirm-button" @click="loadFormulaText">Load formula</button></div>
      </section>
    </div>
    <div v-if="pendingBackup" class="modal-backdrop" @click.self="pendingBackup = null">
      <section class="modifier-panel" role="dialog" aria-modal="true" aria-labelledby="backup-title">
        <div class="panel-topline"><span class="eyebrow">BACKUP</span><button aria-label="Cancel import" class="icon-button" @click="pendingBackup = null">×</button></div>
        <h2 id="backup-title">Restore backup?</h2>
        <p class="panel-note">This replaces your current formulas, history, preferences, and draft with {{ pendingBackup.savedFormulas.length }} saved formulas and {{ pendingBackup.history.length }} rolls from the backup.</p>
        <div class="panel-actions"><button class="quiet-action" @click="pendingBackup = null">Cancel</button><button class="confirm-button" @click="restoreBackup">Restore</button></div>
      </section>
    </div>
    <span class="sr-only" aria-live="assertive">{{ rollAnnouncement }}</span>
  </main>
</template>
