let cvPromise = null

/**
 * Load the OpenCV.js WASM bundle once and resolve when the runtime is ready.
 * The bundle is copied from node_modules into src/assets by scripts/copy-opencv.mjs.
 */
export function loadOpenCV() {
  if (cvPromise) return cvPromise

  // public/opencv/opencv.js is copied from node_modules by scripts/copy-opencv.mjs.
  // A relative URL works both in Vite dev (http://…) and in Electron (file://…).
  const opencvUrl = new URL('opencv/opencv.js', document.baseURI).href

  cvPromise = new Promise((resolve, reject) => {
    if (window.cv && window.cv.Mat) {
      // Wrap in a plain object: the Emscripten module has a `then` method,
      // so resolving a promise with it directly would assimilate the thenable.
      resolve({ cv: window.cv })
      return
    }

    const script = document.createElement('script')
    script.src = opencvUrl
    script.async = true

    script.onload = () => waitForRuntime(resolve, reject)
    script.onerror = () => reject(new Error('Не удалось загрузить OpenCV.js'))

    document.head.appendChild(script)
  })

  return cvPromise
}

function waitForRuntime(resolve, reject) {
  const started = Date.now()
  const timer = window.setInterval(() => {
    const cv = window.cv

    if (cv && cv.Mat) {
      window.clearInterval(timer)
      resolve({ cv })
      return
    }

    if (cv && typeof cv.then === 'function') {
      cv.then((module) => {
        window.clearInterval(timer)
        resolve({ cv: module })
      })
      return
    }

    if (Date.now() - started > 60_000) {
      window.clearInterval(timer)
      reject(new Error('OpenCV.js не инициализировался за 60 секунд'))
    }
  }, 100)
}
