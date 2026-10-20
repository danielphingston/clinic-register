// Per-device identity for sync (never synced; kept in localStorage).
const ID_KEY = 'sync:deviceId'
const NAME_KEY = 'sync:deviceName'

export function getDeviceId(): string {
  let id = localStorage.getItem(ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ID_KEY, id)
  }
  return id
}

export function defaultDeviceName(ua = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : ''
  return os ? `${browser} on ${os}` : browser
}

export function getDeviceName(): string {
  return localStorage.getItem(NAME_KEY) || defaultDeviceName()
}

export function setDeviceName(name: string) {
  const n = name.trim()
  if (n) localStorage.setItem(NAME_KEY, n.slice(0, 60))
  else localStorage.removeItem(NAME_KEY)
}
