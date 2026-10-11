const isDev = (() => {
  try {
    return !!(import.meta && import.meta.env && import.meta.env.DEV)
  } catch (_) {
    return false
  }
})()

export const logger = {
  isDev,
  log: (...args) => { if (isDev) console.log(...args) },
  info: (...args) => { if (isDev) console.log(...args) },
  debug: (...args) => { if (isDev) console.log(...args) },
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
}

export default logger
