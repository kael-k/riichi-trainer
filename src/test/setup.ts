import '@testing-library/jest-dom'

// The settings store persists, so zustand writes storage on every setState — and this jsdom
// build exposes no localStorage (node's own needs --localstorage-file). An in-memory stand-in
// is enough: nothing under test reads persisted state back.
if (!globalThis.localStorage) {
  const entries = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, String(value)),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
      key: (index: number) => [...entries.keys()][index] ?? null,
      get length() {
        return entries.size
      },
    } satisfies Storage,
  })
}
