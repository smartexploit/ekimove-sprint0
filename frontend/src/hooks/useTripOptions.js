import { useEffect, useState } from 'react'
import { apiRequest } from '../services/authService.js'

/**
 * Loads service areas, the places in the chosen area and the fare options
 * for the chosen route from the public booking API.
 *
 * Each result is stored with the selection it was loaded for, so stale
 * results and loading flags are derived during render rather than reset
 * inside effects.
 */
export default function useTripOptions({
  areaId,
  originId,
  destinationId,
  passengerCount,
}) {
  const [areasResult, setAreasResult] = useState({ done: false, items: [], error: '' })
  const [placesResult, setPlacesResult] = useState({ key: '', items: [], error: '' })
  const [fareResult, setFareResult] = useState({ key: '', items: [], error: '' })

  useEffect(() => {
    let active = true
    apiRequest('/api/v1/locations/areas')
      .then((data) => {
        if (active) setAreasResult({ done: true, items: Array.isArray(data) ? data : [], error: '' })
      })
      .catch((err) => {
        if (active) setAreasResult({ done: true, items: [], error: err.message })
      })
    return () => {
      active = false
    }
  }, [])

  // With a single live service area (the pilot), use it without asking.
  const effectiveAreaId = areaId
    ? String(areaId)
    : areasResult.items.length === 1
      ? String(areasResult.items[0].id)
      : ''
  const placesKey = effectiveAreaId

  useEffect(() => {
    if (!placesKey) return undefined
    let active = true
    apiRequest(`/api/v1/locations/places?service_area_id=${encodeURIComponent(placesKey)}`)
      .then((data) => {
        if (active) setPlacesResult({ key: placesKey, items: Array.isArray(data) ? data : [], error: '' })
      })
      .catch((err) => {
        if (active) setPlacesResult({ key: placesKey, items: [], error: err.message })
      })
    return () => {
      active = false
    }
  }, [placesKey])

  const routeSelected = Boolean(
    originId && destinationId && String(originId) !== String(destinationId),
  )
  const fareKey = routeSelected
    ? `${originId}|${destinationId}|${passengerCount || 1}`
    : ''

  useEffect(() => {
    if (!fareKey) return undefined
    let active = true
    const [origin, destination, count] = fareKey.split('|')
    apiRequest(
      `/api/v1/place-fare-options?origin_place_id=${encodeURIComponent(origin)}&destination_place_id=${encodeURIComponent(destination)}&passenger_count=${encodeURIComponent(count)}`,
    )
      .then((data) => {
        if (active) setFareResult({ key: fareKey, items: Array.isArray(data) ? data : [], error: '' })
      })
      .catch((err) => {
        if (active) setFareResult({ key: fareKey, items: [], error: err.message })
      })
    return () => {
      active = false
    }
  }, [fareKey])

  const placesCurrent = Boolean(placesKey) && placesResult.key === placesKey
  const faresCurrent = Boolean(fareKey) && fareResult.key === fareKey

  return {
    effectiveAreaId,
    areas: areasResult.items,
    loadingAreas: !areasResult.done,
    areasError: areasResult.error,
    places: placesCurrent ? placesResult.items : [],
    loadingPlaces: Boolean(placesKey) && !placesCurrent,
    placesError: placesCurrent ? placesResult.error : '',
    routeSelected,
    fareOptions: faresCurrent ? fareResult.items : [],
    loadingFares: Boolean(fareKey) && !faresCurrent,
    faresError: faresCurrent ? fareResult.error : '',
  }
}
