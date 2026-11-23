/** Wrap a refresh function so it does nothing while the page is hidden
 * (another tab, the phone screen off, the app in the background). Every
 * refresh reads the database, so skipping hidden ones saves a lot. */
export const whenVisible = (fn) => () => {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') fn()
}
