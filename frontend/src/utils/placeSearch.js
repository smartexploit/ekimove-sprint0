/**
 * Finds places as people type: by name, other names (aliases set in the
 * console, like "Main Gate" or a junction), street/address and zone.
 * Ignores capitals, Yoruba accents and punctuation, and forgives a small
 * typo in longer words ("iworko" still finds Iworoko).
 */

export function normalise(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // ọ́ → o, ẹ → e
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const words = (text) => normalise(text).split(' ').filter(Boolean)

// At most one letter added, missing, changed or swapped.
function oneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1
  if (i === a.length && i === b.length) return true
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a]
  return long.slice(i + 1) === short.slice(i)
}

// How well one typed word matches the words of a field (0 = not at all).
function wordScore(term, fieldWords) {
  let best = 0
  for (const word of fieldWords) {
    if (word === term) return 4
    if (word.startsWith(term)) best = Math.max(best, 3)
    else if (term.length >= 3 && word.includes(term)) best = Math.max(best, 2)
    else if (term.length >= 4 && (oneEditApart(term, word) || oneEditApart(term, word.slice(0, term.length)))) {
      best = Math.max(best, 1)
    }
  }
  return best
}

/** Prepare places once (normalised words) so typing stays fast. */
export function indexPlaces(places) {
  return places.map((place) => ({
    place,
    name: words(place.name),
    nameText: normalise(place.name),
    aliases: (place.aliases || []).map((alias) => ({ alias, words: words(alias) })),
    other: words(`${place.address_text || ''} ${place.zone || ''} ${place.place_type || ''}`),
  }))
}

/**
 * Places matching the query, best first. Each result says why it matched
 * (e.g. the other name that was found) so the list can show it.
 */
export function searchPlaces(index, query, limit = 40) {
  const terms = words(query)
  if (!terms.length) return index.map((item) => ({ place: item.place, via: null }))
  const results = []
  for (const item of index) {
    let total = 0
    let via = null
    let ok = true
    for (const term of terms) {
      const fromName = wordScore(term, item.name) * 3
      let fromAlias = 0
      let alias = null
      for (const entry of item.aliases) {
        const score = wordScore(term, entry.words) * 2
        if (score > fromAlias) {
          fromAlias = score
          alias = entry.alias
        }
      }
      const fromOther = wordScore(term, item.other)
      const best = Math.max(fromName, fromAlias, fromOther)
      if (!best) {
        ok = false
        break
      }
      total += best
      if (best === fromAlias && fromAlias > fromName && !via) via = alias
    }
    if (!ok) continue
    if (item.nameText.startsWith(normalise(query))) total += 10
    results.push({ place: item.place, via, total })
  }
  results.sort((a, b) => b.total - a.total || a.place.name.localeCompare(b.place.name))
  return results.slice(0, limit)
}
