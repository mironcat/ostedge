import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'node_modules', '@techstark', 'opencv-js', 'dist', 'opencv.js')
const targetDir = path.join(root, 'public', 'opencv')
const target = path.join(targetDir, 'opencv.js')

if (!fs.existsSync(source)) {
  console.error('OpenCV.js not found. Run "npm install" first.')
  process.exit(1)
}

fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, target)
console.log(`Copied OpenCV.js (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)} MB) to public/opencv/opencv.js`)
