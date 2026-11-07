import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

// Render at 2x and downsample for smooth edges.
const SIZE = 1024
const SS = 2
const W = SIZE * SS
const pixels = new Uint8Array(W * W * 4)

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= W || a <= 0) return

  const index = (y * W + x) * 4
  const sourceAlpha = Math.min(1, a)
  const destAlpha = pixels[index + 3] / 255
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha)

  if (outAlpha <= 0) return

  pixels[index] = Math.round((r * sourceAlpha + pixels[index] * destAlpha * (1 - sourceAlpha)) / outAlpha)
  pixels[index + 1] = Math.round((g * sourceAlpha + pixels[index + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha)
  pixels[index + 2] = Math.round((b * sourceAlpha + pixels[index + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha)
  pixels[index + 3] = Math.round(outAlpha * 255)
}

function roundedRectSdf(x, y, cx, cy, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x - cx) - (halfWidth - radius)
  const dy = Math.abs(y - cy) - (halfHeight - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

function fillCircle(cx, cy, radius, r, g, b, a) {
  const x0 = Math.max(0, Math.floor(cx - radius - 1))
  const x1 = Math.min(W - 1, Math.ceil(cx + radius + 1))
  const y0 = Math.max(0, Math.floor(cy - radius - 1))
  const y1 = Math.min(W - 1, Math.ceil(cy + radius + 1))
  const radiusSquared = radius * radius

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const distanceSquared = (x - cx) ** 2 + (y - cy) ** 2
      if (distanceSquared > radiusSquared + radius) continue

      const distance = Math.sqrt(distanceSquared)
      const edge = Math.min(1, Math.max(0, radius - distance + 0.5))
      blend(x, y, r, g, b, a * edge)
    }
  }
}

function fillPolygon(points, r, g, b, a) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))))
  const maxY = Math.min(W - 1, Math.ceil(Math.max(...points.map((point) => point.y))))

  for (let y = minY; y <= maxY; y += 1) {
    const intersections = []

    for (let index = 0; index < points.length; index += 1) {
      const first = points[index]
      const second = points[(index + 1) % points.length]

      if ((first.y <= y && second.y > y) || (second.y <= y && first.y > y)) {
        const t = (y - first.y) / (second.y - first.y)
        intersections.push(first.x + t * (second.x - first.x))
      }
    }

    intersections.sort((left, right) => left - right)

    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, Math.ceil(intersections[index]))
      const end = Math.min(W - 1, Math.floor(intersections[index + 1]))
      for (let x = start; x <= end; x += 1) blend(x, y, r, g, b, a)
    }
  }
}

function strokePolygon(points, radius, r, g, b, a) {
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index]
    const second = points[(index + 1) % points.length]
    const steps = Math.max(1, Math.ceil(Math.hypot(second.x - first.x, second.y - first.y)))

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      fillCircle(
        first.x + (second.x - first.x) * t,
        first.y + (second.y - first.y) * t,
        radius,
        r,
        g,
        b,
        a,
      )
    }
  }
}

function shellPoints(scale = 1, centerX = W / 2, centerY = W / 2) {
  const points = []
  const a = W * 0.30 * scale
  const b = W * 0.195 * scale

  for (let index = 0; index < 360; index += 1) {
    const angle = (index * Math.PI) / 180
    let x = a * Math.cos(angle)
    let y = b * Math.sin(angle)

    // Slight bean-like asymmetry and a ventral notch.
    x += 0.04 * a * Math.sin(2 * angle)
    const notch = Math.exp(-(((x - 0.18 * a) / (0.22 * a)) ** 2))
      * Math.max(0, Math.sin(angle))
      * 0.24 * b
    y -= notch

    points.push({ x: centerX + x, y: centerY + y })
  }

  return points
}

const centerX = W / 2
const centerY = W / 2

// Rounded square background with a subtle cyan glow.
for (let y = 0; y < W; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const sdf = roundedRectSdf(x, y, centerX, centerY, W * 0.48, W * 0.48, W * 0.22)
    if (sdf > 0) continue

    blend(x, y, 8, 13, 24, 1)

    const distance = Math.hypot(x - centerX, y - centerY) / (W * 0.5)
    const glow = Math.max(0, 1 - distance) ** 2 * 0.22
    blend(x, y, 34, 211, 238, glow)

    // Fine inner border.
    if (sdf > -W * 0.006) {
      blend(x, y, 34, 211, 238, 0.35)
    }
  }
}

const outerShell = shellPoints(1)

// Shell shadow / depth.
fillPolygon(shellPoints(0.97, centerX + W * 0.012, centerY + W * 0.014), 3, 8, 15, 0.65)
fillPolygon(outerShell, 12, 46, 60, 1)

// Growth lines.
for (const scale of [0.78, 0.58, 0.38]) {
  strokePolygon(shellPoints(scale), Math.max(1.5, W * 0.0035), 34, 211, 238, 0.28)
}

// Bright shell outline.
strokePolygon(outerShell, W * 0.0105, 34, 211, 238, 1)

// Subtle highlight on the upper-left part of the shell.
for (let index = 0; index < 30; index += 1) {
  const t = index / 29
  fillCircle(
    centerX - W * 0.16 + t * W * 0.18,
    centerY - W * 0.07 - Math.sin(t * Math.PI) * W * 0.035,
    W * 0.012 * (1 - t),
    175,
    245,
    255,
    0.18 * (1 - t),
  )
}

// A small landmark dot to hint at the morphometrics idea.
fillCircle(centerX - W * 0.30, centerY + W * 0.02, W * 0.012, 251, 191, 36, 1)
fillCircle(centerX + W * 0.30, centerY, W * 0.012, 251, 191, 36, 1)

// Downsample.
const output = new PNG({ width: SIZE, height: SIZE })
const samples = SS * SS

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let red = 0
    let green = 0
    let blue = 0
    let alpha = 0

    for (let dy = 0; dy < SS; dy += 1) {
      for (let dx = 0; dx < SS; dx += 1) {
        const source = (((y * SS + dy) * W) + (x * SS + dx)) * 4
        red += pixels[source]
        green += pixels[source + 1]
        blue += pixels[source + 2]
        alpha += pixels[source + 3]
      }
    }

    const target = (y * SIZE + x) * 4
    output.data[target] = Math.round(red / samples)
    output.data[target + 1] = Math.round(green / samples)
    output.data[target + 2] = Math.round(blue / samples)
    output.data[target + 3] = Math.round(alpha / samples)
  }
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targetDir = path.join(root, 'build')
const targetFile = path.join(targetDir, 'icon.png')

fs.mkdirSync(targetDir, { recursive: true })
fs.writeFileSync(targetFile, PNG.sync.write(output))
console.log(`Icon written to ${targetFile}`)
