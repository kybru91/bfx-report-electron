'use strict'

const electron = require('electron')

const ipcs = require('./ipcs')
const showErrorModalDialog = require('./show-error-modal-dialog')
const showMessageModalDialog = require('./show-message-modal-dialog')
const pauseApp = require('./pause-app')
const relaunch = require('./relaunch')
const { rm } = require('./helpers')
const { DbRemovingError } = require('./errors')
const {
  DB_FILE_NAME,
  SECRET_KEY_FILE_NAME
} = require('./const')

const _rmDb = async (pathToUserData) => {
  try {
    await rm(
      pathToUserData,
      {
        include: [
          DB_FILE_NAME,
          SECRET_KEY_FILE_NAME,
          '.db',
          '.db-shm',
          '.db-wal'
        ]
      }
    )
  } catch (err) {
    console.error(err)

    throw new DbRemovingError()
  }
}

const _clearAllTables = () => {
  ipcs.serverIpc.send({
    state: 'clear-all-tables'
  })

  return new Promise((resolve, reject) => {
    const handlerMess = (mess) => {
      const { state } = { ...mess }

      if (
        state !== 'all-tables-have-been-cleared' &&
        state !== 'all-tables-have-not-been-cleared'
      ) {
        return
      }

      ipcs.serverIpc.removeListener('error', handlerErr)
      ipcs.serverIpc.removeListener('message', handlerMess)

      if (state === 'all-tables-have-not-been-cleared') {
        reject(new DbRemovingError(state))

        return
      }

      resolve()
    }
    const handlerErr = (err) => {
      ipcs.serverIpc.removeListener('message', handlerMess)

      reject(err)
    }

    ipcs.serverIpc.once('error', handlerErr)
    ipcs.serverIpc.on('message', handlerMess)
  })
}

module.exports = ({
  pathToUserData,
  shouldAllTablesBeCleared
}) => {
  return async () => {
    const win = electron.BrowserWindow.getFocusedWindow()
    const title = shouldAllTablesBeCleared
      ? 'Clear all data'
      : 'Remove database'
    const message = shouldAllTablesBeCleared
      ? 'Are you sure you want to clear all data?'
      : 'Are you sure you want to remove the database?'

    try {
      const {
        btnId
      } = await showMessageModalDialog(win, {
        type: 'question',
        title,
        message
      })
      const isOkBtnPushed = btnId === 1

      if (!isOkBtnPushed) {
        return
      }

      await pauseApp({
        beforeClosingServHook: async () => {
          if (!shouldAllTablesBeCleared) {
            return
          }

          await _clearAllTables()
        }
      })

      if (!shouldAllTablesBeCleared) {
        await _rmDb(pathToUserData)
      }

      relaunch()
    } catch (err) {
      try {
        await showErrorModalDialog(win, title, err)
      } catch (err) {
        console.error(err)
      }

      console.error(err)
      relaunch()
    }
  }
}
