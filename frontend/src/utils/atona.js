export const OPEN_ATONA_EVENT = 'ekimove:open-atona'

/** Open the Atọ́nà chat from anywhere (for example a header button). */
export function openAtona() {
  window.dispatchEvent(new Event(OPEN_ATONA_EVENT))
}
