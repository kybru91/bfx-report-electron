'use strict'

const { app, screen, remote } = require('electron')
const fs = require('fs')
const path = require('path')
const Alert = require('electron-alert')
const i18next = require('i18next')

const ipcs = require('../ipcs')
const wins = require('../window-creators/windows')
const {
  deserializeError
} = require('../helpers/utils')
const isMainWinAvailable = require(
  '../helpers/is-main-win-available'
)
const getAlertCustomClassObj = require(
  '../helpers/get-alert-custom-class-obj'
)
const getUIFontsAsCSSString = require(
  '../helpers/get-ui-fonts-as-css-string'
)
const showMessageModalDialog = require(
  '../show-message-modal-dialog'
)
const {
  closeAlert
} = require('../modal-dialog-src/utils')
const {
  DbRestoringError
} = require('../errors')
const {
  WINDOW_EVENT_NAMES,
  addOnceProcEventHandler
} = require('../window-creators/window-event-manager')
const ThemeIpcChannelHandlers = require(
  '../window-creators/main-renderer-ipc-bridge/theme-ipc-channel-handlers'
)

const fontsStyle = getUIFontsAsCSSString()
const themesStyle = fs.readFileSync(path.join(
  __dirname, '../window-creators/layouts/themes.css'
))
const alertStyle = fs.readFileSync(path.join(
  __dirname, '../modal-dialog-src/modal-dialog.css'
))
const alertScript = fs.readFileSync(path.join(
  __dirname, '../modal-dialog-src/modal-dialog.js'
))

const PROCESS_MESSAGES = require(
  '../../bfx-reports-framework/workers/loc.api/process.message.manager/process.messages'
)
const PROCESS_STATES = require(
  '../../bfx-reports-framework/workers/loc.api/process.message.manager/process.states'
)

const fonts = `<style>${fontsStyle}</style>`
const themes = `<style>${themesStyle}</style>`
const style = `<style>${alertStyle}</style>`
const script = `<script type="text/javascript">${alertScript}</script>`
const sound = { freq: 'F2', type: 'triange', duration: 1.5 }

const _fireAlert = (params) => {
  const {
    title = i18next.t('restoreDB.modalDialog.title'),
    backupFilesMetadata
  } = params
  const win = wins.mainWindow

  if (!isMainWinAvailable()) {
    return { value: false }
  }

  const inputOptions = backupFilesMetadata.reduce((accum, item) => {
    accum[item?.name] = item?.name

    return accum
  }, {})
  const inputValue = backupFilesMetadata[0]?.name

  const _screen = screen || remote.screen
  const {
    getCursorScreenPoint,
    getDisplayNearestPoint
  } = _screen
  const {
    workArea
  } = getDisplayNearestPoint(getCursorScreenPoint())
  const { height: screenHeight } = workArea
  const maxHeight = Math.floor(screenHeight * 0.90)

  const alert = new Alert([fonts, themes, style, script])

  const eventHandlerCtx = addOnceProcEventHandler(
    WINDOW_EVENT_NAMES.CLOSED,
    () => closeAlert(alert)
  )

  const bwOptions = {
    resizable: true,
    frame: false,
    transparent: false,
    thickFrame: false,
    closable: false,
    hasShadow: false,
    backgroundColor: ThemeIpcChannelHandlers.getWindowBackgroundColor(),
    darkTheme: false,
    parent: win,
    modal: true,
    minWidth: 1000
  }
  const swalOptions = {
    position: 'center',
    allowOutsideClick: false,
    customClass: getAlertCustomClassObj({
      title: 'titleColor',
      container: 'textColor',
      htmlContainer: 'select-db-backup ',
      input: 'textColor radioInput'
    }),

    icon: 'question',
    title,
    showConfirmButton: true,
    focusCancel: true,
    showCancelButton: true,
    confirmButtonText: i18next.t('common.confirmButtonText'),
    cancelButtonText: i18next.t('common.cancelButtonText'),
    timerProgressBar: false,

    input: 'radio',
    inputValue,
    inputOptions,

    willOpen: () => {
      if (
        !alert ||
        !alert.browserWindow
      ) return

      alert.browserWindow.hide()
    },
    didOpen: () => {
      if (
        !alert ||
        !alert.browserWindow
      ) return

      alert.browserWindow.show()
      const { height } = alert.browserWindow
        .getContentBounds()
      alert.browserWindow.setBounds({
        height: height > maxHeight
          ? maxHeight
          : height
      })
    },
    willClose: () => {
      if (
        !alert ||
        !alert.browserWindow
      ) return

      alert.browserWindow.hide()
    },
    didClose: () => {
      eventHandlerCtx.removeListener()
    }
  }

  const res = alert.fire(
    swalOptions,
    bwOptions,
    null,
    true,
    false,
    sound
  )

  return res
}

const _getBackupFilesMetadata = (ipc) => {
  return new Promise((resolve, reject) => {
    try {
      let interval = null

      const rmHandler = () => {
        ipc.off('message', handler)
        clearInterval(interval)
      }
      const handler = (mess) => {
        if (mess?.state !== PROCESS_MESSAGES.RESPONSE_GET_BACKUP_FILES_METADATA) {
          return
        }

        const { data } = mess

        interval = setInterval(() => {
          rmHandler()
          reject(new DbRestoringError())
        }, 30 * 1000).unref()

        if (data?.err) {
          rmHandler()
          reject(deserializeError(data.err))

          return
        }

        rmHandler()
        resolve(data?.backupFilesMetadata)
      }

      ipc.on('message', handler)
      ipc.send({
        state: PROCESS_STATES.REQUEST_GET_BACKUP_FILES_METADATA
      })
    } catch (err) {
      reject(err)
    }
  })
}

module.exports = () => {
  return async () => {
    try {
      if (
        !app.isReady() ||
        !isMainWinAvailable()
      ) {
        throw new DbRestoringError()
      }

      const backupFilesMetadata = await _getBackupFilesMetadata(
        ipcs.serverIpc
      )

      if (
        !Array.isArray(backupFilesMetadata) ||
        backupFilesMetadata.length === 0
      ) {
        await showMessageModalDialog(wins.mainWindow, {
          type: 'warning',
          title: i18next.t('restoreDB.messageModalDialog.title'),
          message: i18next.t('restoreDB.messageModalDialog.message'),
          buttons: [i18next.t('common.confirmButtonText')],
          defaultId: 0,
          cancelId: 0
        })

        return
      }

      const res = await _fireAlert({ backupFilesMetadata })

      if (
        !res?.value ||
        typeof res?.value !== 'string'
      ) {
        return
      }

      ipcs.serverIpc.send({
        state: PROCESS_STATES.RESTORE_DB,
        data: { name: res.value }
      })
    } catch (err) {
      console.error(err)
    }
  }
}
