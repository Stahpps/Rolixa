<script setup lang="ts">
import { computed } from 'vue'
import { DICE_COLORS, type DiceType } from '../domain/dice'
import PolyDieRoll from './PolyDieRoll.vue'

const props = withDefaults(defineProps<{
  sides: DiceType
  face?: number | null
  label?: string
  decorative?: boolean
}>(), {
  face: null,
  label: '',
  decorative: false,
})

const centerText = computed(() => props.face === null ? (props.label || ('D' + props.sides)) : String(props.face))
const accessibleLabel = computed(() => 'D' + props.sides + (props.face === null ? ' die' : ' showing ' + props.face))
</script>

<template>
  <PolyDieRoll v-if="sides === 100" class="die-illustration" :sides="100" :face="face" :color="DICE_COLORS[100]" :aria-hidden="decorative ? 'true' : undefined" />
  <svg v-else class="die-illustration" viewBox="0 0 100 100" :role="decorative ? undefined : 'img'" :aria-hidden="decorative ? 'true' : undefined" :aria-label="decorative ? undefined : accessibleLabel">
    <g v-if="sides === 4" class="die-lines">
      <path class="die-face-fill" d="M50 8 91 83H9L50 8Z" />
      <path d="M50 8 50 65M9 83 50 65 91 83M50 65 69 45" />
    </g>
    <g v-else-if="sides === 6" class="die-lines">
      <path class="die-face-top" d="M50 8 88 29 50 50 12 29 50 8Z" />
      <path class="die-face-left" d="M12 29 50 50V92L12 71V29Z" />
      <path class="die-face-right" d="M88 29 50 50V92L88 71V29Z" />
      <path d="M50 8V50M12 29 50 50 88 29M50 50V92" />
    </g>
    <g v-else-if="sides === 8" class="die-lines">
      <path class="die-face-fill" d="M50 7 91 50 50 93 9 50 50 7Z" />
      <path d="M50 7 50 93M9 50 91 50M50 50 22 22M50 50 78 22M50 50 22 78M50 50 78 78" />
    </g>
    <g v-else-if="sides === 10" class="die-lines">
      <path class="die-face-fill" d="M50 7 82 27 73 70 50 93 27 70 18 27 50 7Z" />
      <path d="M50 7 50 50 18 27M50 50 82 27M50 50 73 70M50 50 50 93M50 50 27 70" />
    </g>
    <g v-else-if="sides === 12" class="die-lines">
      <path class="die-face-fill" d="M50 7 76 14 91 37 85 65 64 89 36 89 15 65 9 37 24 14 50 7Z" />
      <path d="M50 7 63 35 91 37M76 14 63 35 85 65M85 65 63 60 64 89M64 89 50 60 36 89M36 89 37 60 15 65M15 65 37 35 9 37M9 37 37 35 24 14M24 14 50 42 50 7M50 42 63 35M50 42 37 35M50 42 63 60M50 42 50 60M50 42 37 60" />
    </g>
    <g v-else-if="sides === 20" class="die-lines">
      <path class="die-face-fill" d="M50 6 89 28 89 72 50 94 11 72 11 28 50 6Z" />
      <path d="M50 6 30 38 11 28M50 6 70 38 89 28M30 38 70 38 89 72M30 38 11 72 50 94M30 38 50 94M70 38 50 94M70 38 89 72M30 38 50 6M70 38 50 6M30 38 11 72M70 38 11 72" />
    </g>
    <text class="die-number" x="50" y="59" text-anchor="middle" dominant-baseline="central">{{ centerText }}</text>
  </svg>
</template>

<style scoped>
.die-illustration { display: block; width: 100%; height: 100%; overflow: visible; color: var(--die-color, #a8ff00); }
.die-lines path { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.8; vector-effect: non-scaling-stroke; }
.die-lines .die-face-fill { fill: color-mix(in srgb, currentColor, transparent 90%); }
.die-lines .die-face-top { fill: color-mix(in srgb, currentColor, transparent 78%); }
.die-lines .die-face-left { fill: color-mix(in srgb, currentColor, transparent 87%); }
.die-lines .die-face-right { fill: color-mix(in srgb, currentColor, transparent 94%); }
.die-number { fill: currentColor; stroke: none !important; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 20px; font-weight: 800; paint-order: stroke; }
.percent-mark { fill: currentColor; stroke: none !important; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 18px; font-weight: 800; }
.percent-number { font-size: 17px; }
</style>
