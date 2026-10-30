<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { DiceType } from '../domain/dice'

type Vec3 = [number, number, number]
type Quat = [number, number, number, number]
interface Face { indices: number[]; normal: Vec3; number: number }
interface Mesh { vertices: Vec3[]; loops: number[][] }

const props = withDefaults(defineProps<{
  sides: DiceType
  face?: number | null
  color?: string
  rolling?: boolean
  rollKey?: number
  durationMs?: number
  delayMs?: number
}>(), {
  face: null,
  color: '#A8FF00',
  rolling: false,
  rollKey: 0,
  durationMs: 600,
  delayMs: 0,
})

const canvas = ref<HTMLCanvasElement | null>(null)
const accessibleLabel = computed(() => 'D' + props.sides + (props.face === null ? ' die' : ' showing ' + props.face))
let observer: ResizeObserver | undefined
let frame = 0
let orientation: Quat = [1, 0, 0, 0]
let width = 0
let height = 0
let pixelRatio = 1

function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function subtract(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function normalizeVector(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}
function normalizeQuat(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length]
}
function multiplyQuat(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a
  const [bw, bx, by, bz] = b
  return normalizeQuat([
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ])
}
function axisAngle(axis: Vec3, angle: number): Quat {
  const half = angle / 2
  const s = Math.sin(half)
  return [Math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s]
}
function rotateVector(vector: Vec3, q: Quat): Vec3 {
  const u: Vec3 = [q[1], q[2], q[3]]
  const uv = cross(u, vector)
  const uuv = cross(u, uv)
  return add(vector, add(uv.map((n) => n * 2 * q[0]) as Vec3, uuv.map((n) => n * 2) as Vec3))
}
function fromTo(from: Vec3, to: Vec3): Quat {
  const cosine = dot(from, to)
  if (cosine < -0.999999) return axisAngle([1, 0, 0], Math.PI)
  const axis = cross(from, to)
  return normalizeQuat([1 + cosine, axis[0], axis[1], axis[2]])
}
function slerp(a: Quat, b: Quat, t: number): Quat {
  let target = b
  let cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  if (cosine < 0) {
    cosine = -cosine
    target = [-b[0], -b[1], -b[2], -b[3]]
  }
  if (cosine > 0.9995) return normalizeQuat(a.map((value, i) => value + (target[i]! - value) * t) as Quat)
  const theta = Math.acos(Math.min(1, cosine))
  const sine = Math.sin(theta)
  const left = Math.sin((1 - t) * theta) / sine
  const right = Math.sin(t * theta) / sine
  return normalizeQuat(a.map((value, i) => value * left + target[i]! * right) as Quat)
}

function regularTriangleLoops(vertices: Vec3[]): number[][] {
  let shortest = Infinity
  for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) {
    const delta = subtract(vertices[i]!, vertices[j]!)
    shortest = Math.min(shortest, dot(delta, delta))
  }
  const loops: number[][] = []
  for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) for (let k = j + 1; k < vertices.length; k++) {
    const a = subtract(vertices[i]!, vertices[j]!)
    const b = subtract(vertices[i]!, vertices[k]!)
    const c = subtract(vertices[j]!, vertices[k]!)
    if ([dot(a, a), dot(b, b), dot(c, c)].every((length) => Math.abs(length - shortest) < 0.0001)) loops.push([i, j, k])
  }
  return loops
}

function icosahedron(): Mesh {
  const phi = (1 + Math.sqrt(5)) / 2
  const raw: Vec3[] = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ]
  const vertices = raw.map(normalizeVector)
  return { vertices, loops: regularTriangleLoops(vertices) }
}

function dodecahedron(): Mesh {
  const ico = icosahedron()
  const vertices = ico.loops.map((loop) => normalizeVector(loop.reduce((sum, index) => add(sum, ico.vertices[index]!), [0, 0, 0] as Vec3)))
  const loops = ico.vertices.map((axis) => {
    const incident = ico.loops.map((loop, index) => ({ loop, index })).filter(({ loop }) => loop.some((vertexIndex) => dot(axis, ico.vertices[vertexIndex]!) > 0.999))
    const reference: Vec3 = Math.abs(axis[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1]
    const u = normalizeVector(cross(reference, axis))
    const v = cross(axis, u)
    return incident
      .map(({ index }) => ({ index, center: vertices[index]! }))
      .sort((a, b) => Math.atan2(dot(a.center, v), dot(a.center, u)) - Math.atan2(dot(b.center, v), dot(b.center, u)))
      .map(({ index }) => index)
  })
  return { vertices, loops }
}

let zocchihedronMesh: Mesh | undefined
function zocchihedron(): Mesh {
  if (zocchihedronMesh) return zocchihedronMesh

  const base = icosahedron()
  const vertices: Vec3[] = []
  const vertexByPosition = new Map<string, number>()
  const triangles: number[][] = []
  const frequency = 3
  const pointIndex = (a: Vec3, b: Vec3, c: Vec3, i: number, j: number) => {
    const k = frequency - i - j
    const point = normalizeVector([
      (a[0] * k + b[0] * i + c[0] * j) / frequency,
      (a[1] * k + b[1] * i + c[1] * j) / frequency,
      (a[2] * k + b[2] * i + c[2] * j) / frequency,
    ])
    const key = point.map((coordinate) => coordinate.toFixed(6)).join(',')
    const existing = vertexByPosition.get(key)
    if (existing !== undefined) return existing
    const index = vertices.push(point) - 1
    vertexByPosition.set(key, index)
    return index
  }

  for (const loop of base.loops) {
    const [a, b, c] = loop.map((index) => base.vertices[index]!) as [Vec3, Vec3, Vec3]
    const points = new Map<string, number>()
    const getPoint = (i: number, j: number) => {
      const key = `${i},${j}`
      if (!points.has(key)) points.set(key, pointIndex(a, b, c, i, j))
      return points.get(key)!
    }
    for (let i = 0; i < frequency; i++) for (let j = 0; j < frequency - i; j++) {
      const lowerLeft = getPoint(i, j)
      const lowerRight = getPoint(i + 1, j)
      const upperLeft = getPoint(i, j + 1)
      triangles.push([lowerLeft, lowerRight, upperLeft])
      if (i + j < frequency - 1) triangles.push([lowerRight, getPoint(i + 1, j + 1), upperLeft])
    }
  }

  const split = new Set<number>()
  for (let i = 0; i < 8; i++) split.add(Math.floor((i + 0.5) * triangles.length / 8))
  const refinedTriangles: number[][] = []
  triangles.forEach((triangle, index) => {
    if (!split.has(index)) {
      refinedTriangles.push(triangle)
      return
    }
    const center = normalizeVector(triangle.reduce((sum, vertexIndex) => add(sum, vertices[vertexIndex]!), [0, 0, 0] as Vec3))
    const centerIndex = vertices.push(center) - 1
    refinedTriangles.push([triangle[0]!, triangle[1]!, centerIndex], [triangle[1]!, triangle[2]!, centerIndex], [triangle[2]!, triangle[0]!, centerIndex])
  })

  const dualVertices = refinedTriangles.map((triangle) => normalizeVector(
    triangle.reduce((sum, index) => add(sum, vertices[index]!), [0, 0, 0] as Vec3),
  ))
  const incidentFaces = vertices.map(() => [] as number[])
  refinedTriangles.forEach((triangle, faceIndex) => triangle.forEach((vertexIndex) => incidentFaces[vertexIndex]!.push(faceIndex)))
  const loops = vertices.map((axis, vertexIndex) => {
    const reference: Vec3 = Math.abs(axis[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1]
    const u = normalizeVector(cross(reference, axis))
    const v = cross(axis, u)
    return incidentFaces[vertexIndex]!
      .map((faceIndex) => ({ faceIndex, center: dualVertices[faceIndex]! }))
      .sort((left, right) => Math.atan2(dot(left.center, v), dot(left.center, u)) - Math.atan2(dot(right.center, v), dot(right.center, u)))
      .map(({ faceIndex }) => faceIndex)
  })

  zocchihedronMesh = { vertices: dualVertices, loops }
  return zocchihedronMesh
}

function meshFor(sides: DiceType): Mesh {
  if (sides === 4) {
    const raw: Vec3[] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]
    const vertices = raw.map(normalizeVector)
    return { vertices, loops: regularTriangleLoops(vertices) }
  }
  if (sides === 6) {
    const vertices: Vec3[] = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ]
    return { vertices, loops: [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]] }
  }
  if (sides === 8) {
    const vertices: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    return { vertices, loops: regularTriangleLoops(vertices) }
  }
  if (sides === 10) {
    const vertices: Vec3[] = [[0, 0, 1.55], [0, 0, -1.55]]
    const upper: number[] = []
    const lower: number[] = []
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * 2 * i / 5
      const b = a + Math.PI / 5
      upper.push(vertices.push([Math.cos(a), Math.sin(a), 0.36]) - 1)
      lower.push(vertices.push([Math.cos(b), Math.sin(b), -0.36]) - 1)
    }
    const loops: number[][] = []
    for (let i = 0; i < 5; i++) {
      const next = (i + 1) % 5
      const previous = (i + 4) % 5
      loops.push([0, upper[i]!, lower[i]!, upper[next]!])
      loops.push([1, lower[previous]!, upper[i]!, lower[i]!])
    }
    return { vertices: vertices.map(normalizeVector), loops }
  }
  if (sides === 12) return dodecahedron()
  if (sides === 100) return zocchihedron()
  return icosahedron()
}

function makeFaces(mesh: Mesh): Face[] {
  return mesh.loops.map((original, index) => {
    const indices = [...original]
    const points = indices.map((i) => mesh.vertices[i]!)
    let normal: Vec3 = [0, 0, 0]
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!
      const b = points[(i + 1) % points.length]!
      normal = [
        normal[0] + (a[1] - b[1]) * (a[2] + b[2]),
        normal[1] + (a[2] - b[2]) * (a[0] + b[0]),
        normal[2] + (a[0] - b[0]) * (a[1] + b[1]),
      ]
    }
    normal = normalizeVector(normal)
    const center = normalizeVector(points.reduce((sum, point) => add(sum, point), [0, 0, 0] as Vec3))
    if (dot(normal, center) < 0) {
      indices.reverse()
      normal = [-normal[0], -normal[1], -normal[2]]
    }
    return { indices, normal, number: index + 1 }
  })
}

function hexRgb(value: string): [number, number, number] {
  const hex = value.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return [168, 255, 0]
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}
function faceColor(normal: Vec3) {
  const base = hexRgb(props.color)
  const light = normalizeVector([-0.45, 0.65, 0.8])
  const amount = 0.48 + Math.max(0, dot(normal, light)) * 0.47 + Math.max(0, normal[2]) * 0.13
  const channels = base.map((channel) => Math.max(0, Math.min(255, Math.round(channel * amount))))
  return 'rgb(' + channels[0] + ' ' + channels[1] + ' ' + channels[2] + ')'
}

const mesh = meshFor(props.sides)
const vertices = mesh.vertices
const faces = makeFaces(mesh)

function resizeCanvas() {
  const node = canvas.value
  if (!node) return
  const rect = node.getBoundingClientRect()
  width = rect.width
  height = rect.height
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  node.width = Math.max(1, Math.round(width * pixelRatio))
  node.height = Math.max(1, Math.round(height * pixelRatio))
  draw()
}

function project(vertex: Vec3, q: Quat): [number, number, number] {
  const v = rotateVector(vertex, q)
  const perspective = 3.8 / (3.8 - v[2] * 0.42)
  const shapeScale = props.sides === 6 ? 0.74 : 1
  const size = Math.min(width, height) * 0.42 * shapeScale
  return [width / 2 + v[0] * size * perspective, height / 2 - v[1] * size * perspective, v[2]]
}

function draw() {
  const node = canvas.value
  const context = node?.getContext('2d')
  if (!node || !context || width <= 0 || height <= 0) return
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  context.clearRect(0, 0, width, height)
  const visible = faces.map((face) => {
    const points = face.indices.map((index) => project(vertices[index]!, orientation))
    const normal = rotateVector(face.normal, orientation)
    const depth = points.reduce((sum, point) => sum + point[2], 0) / points.length
    return { face, points, normal, depth }
  }).filter((item) => item.normal[2] > -0.08).sort((a, b) => a.depth - b.depth)
  const front = visible.reduce<(typeof visible)[number] | null>((best, item) => !best || item.normal[2] > best.normal[2] ? item : best, null)
  const landingNumber = props.face

  for (const item of visible) {
    context.beginPath()
    context.moveTo(item.points[0]![0], item.points[0]![1])
    for (let i = 1; i < item.points.length; i++) context.lineTo(item.points[i]![0], item.points[i]![1])
    context.closePath()
    context.fillStyle = faceColor(item.normal)
    context.fill()
    const isLandingFace = props.sides === 100 && landingNumber !== null && item.face.number === landingNumber
    context.lineWidth = Math.max(1.1, Math.min(width, height) * (isLandingFace ? 0.014 : 0.006))
    context.strokeStyle = isLandingFace ? 'rgba(255,255,238,.98)' : 'rgba(230,255,198,.66)'
    context.stroke()

    const centerX = item.points.reduce((sum, point) => sum + point[0], 0) / item.points.length
    const centerY = item.points.reduce((sum, point) => sum + point[1], 0) / item.points.length
    const baseSize = props.sides === 100
      ? Math.max(5, Math.min(width, height) * 0.052)
      : Math.max(8, Math.min(width, height) * (item.normal[2] > 0.62 ? 0.12 : 0.09))
    context.fillStyle = 'rgba(247,255,236,.97)'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.shadowColor = 'rgba(9,26,4,.72)'
    context.shadowBlur = 2
    if (props.sides === 100) {
      const relativeX = (centerX - width / 2) / (width * 0.42)
      const relativeY = (centerY - height / 2) / (height * 0.42)
      const insideLabelArea = relativeX * relativeX + relativeY * relativeY < 0.78
      if (!isLandingFace && (Math.min(width, height) < 100 || item.normal[2] < 0.08 || !insideLabelArea)) {
        context.shadowBlur = 0
        continue
      }
      const size = String(item.face.number).length > 2 ? baseSize * 0.72 : baseSize * 0.88
      context.font = '800 ' + size + 'px Inter, system-ui, sans-serif'
      context.fillText(String(item.face.number), centerX, centerY)
    } else {
      const size = String(item.face.number).length > 2 ? baseSize * 0.68 : baseSize
      context.font = '800 ' + size + 'px Inter, system-ui, sans-serif'
      context.fillText(String(item.face.number), centerX, centerY)
    }
    context.shadowBlur = 0
  }

  if (front) {
    context.beginPath()
    context.moveTo(front.points[0]![0], front.points[0]![1])
    for (let i = 1; i < front.points.length; i++) context.lineTo(front.points[i]![0], front.points[i]![1])
    context.closePath()
    context.lineWidth = Math.max(1.6, Math.min(width, height) * 0.014)
    context.strokeStyle = 'rgba(244,255,221,.98)'
    context.stroke()
  }
}

function targetOrientation(value: number): Quat {
  const face = faces.find((item) => item.number === value) ?? faces[0]!
  const aligned = fromTo(face.normal, [0, 0, 1])
  return multiplyQuat(axisAngle([0, 0, 1], Math.PI / Math.max(3, faces.length)), aligned)
}

function animateRoll() {
  cancelAnimationFrame(frame)
  if (!canvas.value) return
  if (!props.rolling || props.face === null) {
    orientation = props.face === null ? axisAngle([0.65, 0.2, 0.4], 0.7) : targetOrientation(props.face)
    draw()
    return
  }
  const start = performance.now() + props.delayMs
  const from: Quat = normalizeQuat([0.72, (Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 1.3])
  const to = targetOrientation(props.face)
  const duration = Math.max(1, props.durationMs)
  const turns = 3 + Math.floor(Math.random() * 2)
  const tick = (now: number) => {
    if (now < start) {
      frame = requestAnimationFrame(tick)
      return
    }
    const progress = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    const base = slerp(from, to, eased)
    const spin = axisAngle([0, 0, 1], Math.PI * 2 * turns * (1 - Math.pow(1 - progress, 2)))
    orientation = multiplyQuat(spin, base)
    draw()
    if (progress < 1) frame = requestAnimationFrame(tick)
    else {
      orientation = to
      draw()
    }
  }
  frame = requestAnimationFrame(tick)
}

onMounted(() => {
  if (canvas.value) {
    observer = new ResizeObserver(resizeCanvas)
    observer.observe(canvas.value)
  }
  resizeCanvas()
  animateRoll()
})
watch(() => props.rollKey, animateRoll)
onUnmounted(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
})
</script>

<template>
  <canvas ref="canvas" class="poly-die-canvas" role="img" :aria-label="accessibleLabel" />
</template>

<style scoped>
.poly-die-canvas { display: block; width: 100%; height: 100%; overflow: visible; }
</style>
