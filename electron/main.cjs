const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b1020',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('before-input-event', (event, input) => {
    const devToolsShortcut = input.key === 'F12'
      || (input.control && input.shift && input.key.toLowerCase() === 'i')
    if (devToolsShortcut) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  return win
}

ipcMain.handle('dialog:openImages', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    title: 'Выберите изображения остракод',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  })

  if (result.canceled || result.filePaths.length === 0) return []

  const records = []
  for (const filePath of result.filePaths) {
    const ext = path.extname(filePath).toLowerCase()
    const mime = MIME_TYPES[ext]
    if (!mime) {
      records.push({
        name: path.basename(filePath),
        size: 0,
        error: `Формат ${ext || '(без расширения)'} не поддерживается. Сохраните изображение как PNG или JPG.`,
      })
      continue
    }
    const buffer = await fs.readFile(filePath)
    records.push({
      name: path.basename(filePath),
      size: buffer.length,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
    })
  }
  return records
})

ipcMain.handle('dialog:saveFile', async (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showSaveDialog(win, {
    title: options.title || 'Сохранить файл',
    defaultPath: options.defaultPath || 'ostedge-export.txt',
    filters: options.filters || [{ name: 'Все файлы', extensions: ['*'] }],
  })

  if (result.canceled || !result.filePath) return { canceled: true }

  await fs.writeFile(result.filePath, options.content, 'utf8')
  return { canceled: false, filePath: result.filePath }
})

ipcMain.handle('app:info', () => ({
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
}))

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
