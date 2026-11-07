const { app, BrowserWindow } = require('electron')
const path = require('node:path')

app.disableHardwareAcceleration()

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)
    }),
  ])
}

const globalTimer = setTimeout(() => {
  console.error('GLOBAL_TIMEOUT')
  app.exit(2)
}, 75_000)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.webContents.on('console-message', (event, level, message) => {
    console.log(`[renderer:${level}] ${message}`)
  })

  win.webContents.on('dom-ready', () => console.log('EVENT dom-ready'))
  win.webContents.on('did-finish-load', () => console.log('EVENT did-finish-load'))
  win.webContents.on('did-stop-loading', () => console.log('EVENT did-stop-loading'))

  win.webContents.on('did-fail-load', (event, code, description, url) => {
    console.error(`EVENT did-fail-load ${code} ${description} ${url}`)
  })

  win.webContents.on('render-process-gone', (event, details) => {
    console.error('EVENT render-process-gone', JSON.stringify(details))
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL

  try {
    if (devUrl) {
      await withTimeout(win.loadURL(devUrl), 30_000, 'loadURL')
      console.log('EVENT loadURL resolved', devUrl)
    } else {
      await withTimeout(
        win.loadFile(path.join(__dirname, '..', 'dist', 'index.html')),
        30_000,
        'loadFile',
      )
      console.log('EVENT loadFile resolved')
    }
  } catch (error) {
    console.error('LOAD_ERROR', error.message)
  }

  let ready = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      ready = await withTimeout(
        win.webContents.executeJavaScript('Boolean(window.cv && window.cv.Mat)'),
        2_000,
        'cv-check',
      )
    } catch (error) {
      console.log(`CHECK_ERROR attempt=${attempt} ${error.message}`)
    }
    if (ready) break
    await wait(500)
  }

  let info = {}
  try {
    info = await withTimeout(
      win.webContents.executeJavaScript(`(() => ({
        cvReady: Boolean(window.cv && window.cv.Mat),
        cvType: typeof window.cv,
        hasBridge: Boolean(window.ostedge),
        hasHeader: Boolean(document.querySelector('.app-header')),
        hasDropZone: Boolean(document.querySelector('.drop-zone')),
        hasRightPanel: Boolean(document.querySelector('.right-panel')),
        scriptCount: document.scripts.length,
        scriptSources: Array.from(document.scripts).map((s) => s.src).slice(-5),
        bodyText: (document.body.innerText || '').slice(0, 300)
      }))()`),
      5_000,
      'info',
    )
  } catch (error) {
    console.error('INFO_ERROR', error.message)
  }

  console.log('SMOKE_RESULT', JSON.stringify(info, null, 2))

  // Full pipeline check: inject a real PNG, let the app process it, read results.
  let processResult = null
  try {
    const imagePath = path.join(__dirname, '..', '..', 'ostracods_edges2.png')
    const dataUrl = `data:image/png;base64,${require('node:fs').readFileSync(imagePath).toString('base64')}`

    processResult = await withTimeout(
      win.webContents.executeJavaScript(`(async () => {
        const blob = await (await fetch(${JSON.stringify(dataUrl)})).blob()
        const file = new File([blob], 'ostracods_edges2.png', { type: 'image/png' })
        await window.__ostedge.addFiles([file])
        const record = window.__ostedge.state.files[0]
        const metrics = Array.from(document.querySelectorAll('.metric')).map((el) => el.innerText)

        // Exercise the real UI calibration flow: button → two canvas clicks → dialog.
        const calibrationButton = Array.from(document.querySelectorAll('.workspace-toolbar button'))
          .find((button) => button.innerText.includes('Калибровка'))
        calibrationButton?.click()
        await new Promise((resolve) => setTimeout(resolve, 100))

        const canvas = document.querySelector('.canvas-inner canvas')
        const rect = canvas.getBoundingClientRect()
        const clickAt = (imageX, imageY) => {
          canvas.dispatchEvent(new MouseEvent('click', {
            clientX: rect.left + (imageX / canvas.width) * rect.width,
            clientY: rect.top + (imageY / canvas.height) * rect.height,
            bubbles: true,
          }))
        }
        clickAt(40, 40)
        await new Promise((resolve) => setTimeout(resolve, 60))
        clickAt(140, 40)
        await new Promise((resolve) => setTimeout(resolve, 250))

        const dialog = document.querySelector('.el-dialog')
        const uiCalibrationText = dialog?.innerText?.slice(0, 300) || ''
        const cancelButton = Array.from(dialog?.querySelectorAll('button') || [])
          .find((button) => button.innerText.trim() === 'Отмена')
        cancelButton?.click()
        await new Promise((resolve) => setTimeout(resolve, 150))

        const before = record?.result?.measurements
        await window.__ostedge.setRecordCalibration(
          window.__ostedge.state.files[0],
          { unitsPerPixel: 0.69, unit: 'µm' },
        )
        const after = window.__ostedge.state.files[0]?.result?.measurements

        return {
          name: record?.name,
          status: record?.status,
          error: record?.error,
          areaPx: before?.area?.px,
          perimeterPx: before?.perimeter?.px,
          aspectRatio: before?.aspectRatio,
          tpsCount: record?.result?.tpsCount,
          unitBefore: before?.unit,
          unitAfter: after?.unit,
          areaBefore: before?.area?.px,
          areaAfter: after?.area?.value,
          scaleAfter: after?.unitsPerPixel,
          uiCalibrationText,
          metricCards: metrics.slice(0, 6),
        }
      })()`),
      60_000,
      'process-image',
    )
  } catch (error) {
    console.error('PROCESS_ERROR', error.message)
  }

  console.log('PROCESS_RESULT', JSON.stringify(processResult, null, 2))

  clearTimeout(globalTimer)
  await wait(300)
  app.exit(ready && processResult?.status === 'done' ? 0 : 1)
}).catch((error) => {
  console.error('SMOKE_ERROR', error)
  clearTimeout(globalTimer)
  app.exit(1)
})
