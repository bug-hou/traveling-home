export function checkForAppUpdate(registration: ServiceWorkerRegistration) {
  if (navigator.onLine && document.visibilityState === 'visible') {
    void registration.update().catch(() => {
      // A transient network error must not interrupt the current session.
    });
  }
}

export function activateAppUpdate(updateServiceWorker: (reloadPage?: boolean) => Promise<void>) {
  return updateServiceWorker(true);
}
