import { useEffect, useState } from 'react'
import { loadSiteContent, siteContentNow } from '../services/siteService.js'

/** Website text and fares, starting from the bundled copy until loaded. */
export default function useSiteContent() {
  const [state, setState] = useState(() => ({ content: siteContentNow(), loaded: false }))

  useEffect(() => {
    let active = true
    loadSiteContent().then((content) => active && setState({ content, loaded: true }))
    return () => {
      active = false
    }
  }, [])

  return state
}
