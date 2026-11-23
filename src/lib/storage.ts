// localStorage with every access guarded. Private mode, blocked site data and a value that does not parse all fall back
// to the caller's default: the app keeps working, it just forgets.

/** The parsed JSON at `key` when `validate` accepts it, else `fallback` (missing, unparsable or the wrong shape). */
export function readJson<T>(key: string, validate: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return validate(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

/** Stores `value` as JSON. A write that fails (private mode, quota) is dropped: the value lasts this session only. */
export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* private mode or quota: the value is not kept */ }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch { /* ignore */ }
}

/** The raw string at `key`, or null. For libraries that store strings themselves (the query cache persister). */
export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch { /* ignore */ }
}
