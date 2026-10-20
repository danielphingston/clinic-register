export function useRegisterSW() {
  const noop = () => {}
  return {
    needRefresh: [false, noop] as const,
    offlineReady: [false, noop] as const,
    updateServiceWorker: async () => {},
  }
}
