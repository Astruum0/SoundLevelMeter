import { app, BrowserWindow, ipcMain, session, systemPreferences } from 'electron'
import { join } from 'node:path'

type PermissionState =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'

const isTrustedRendererOrigin = (origin?: string | null): boolean => {
  if (!origin) {
    return false
  }

  return (
    origin.startsWith('file://') ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:')
  )
}

const getMicrophoneAccessStatus = (): PermissionState => {
  if (process.platform !== 'darwin') {
    return 'granted'
  }

  return systemPreferences.getMediaAccessStatus('microphone') as PermissionState
}

const registerMediaPermissionHandlers = (): void => {
  const defaultSession = session.defaultSession

  defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (permission !== 'media') {
      return false
    }

    const mediaType = 'mediaType' in details ? details.mediaType : 'audio'
    return mediaType === 'audio' && isTrustedRendererOrigin(requestingOrigin)
  })

  defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== 'media') {
      callback(false)
      return
    }

    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    const requestingUrl = 'requestingUrl' in details ? details.requestingUrl : ''
    const audioOnly = mediaTypes.length === 0 || mediaTypes.every((mediaType) => mediaType === 'audio')

    callback(audioOnly && isTrustedRendererOrigin(requestingUrl))
  })
}

const createWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 430,
    height: 560,
    minWidth: 380,
    minHeight: 480,
    backgroundColor: '#090b10',
    autoHideMenuBar: true,
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  registerMediaPermissionHandlers()

  ipcMain.handle('audio-permission:get-status', () => getMicrophoneAccessStatus())
  ipcMain.handle('audio-permission:request', async () => {
    if (process.platform !== 'darwin') {
      return true
    }

    if (getMicrophoneAccessStatus() === 'granted') {
      return true
    }

    return systemPreferences.askForMediaAccess('microphone')
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
