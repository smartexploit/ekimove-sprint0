/** Plain-language distance and arrival time for a tracked trip. */
export function etaText(view) {
  if (!view?.driver_location) return 'Waiting for the driver’s location…'
  if (view.distance_m == null) return 'Driver location received.'
  const distance = view.distance_m < 1000 ? `${view.distance_m} m` : `${(view.distance_m / 1000).toFixed(1)} km`
  if (view.heading_to === 'pickup') {
    return view.status === 'driver_arriving' && view.distance_m < 150
      ? 'The driver is at the pickup point.'
      : `Driver is ${distance} from pickup · about ${view.eta_minutes} min`
  }
  return `${distance} to the destination · about ${view.eta_minutes} min`
}

/** Map markers for pickup, destination and the driver. */
export function tripMarkers(view) {
  const markers = []
  if (view?.pickup?.latitude != null) {
    markers.push({ id: 'pickup', kind: 'pickup', latitude: view.pickup.latitude, longitude: view.pickup.longitude,
      popup: `Pickup: ${view.pickup.name}` })
  }
  if (view?.destination?.latitude != null) {
    markers.push({ id: 'dest', kind: 'destination', latitude: view.destination.latitude,
      longitude: view.destination.longitude, popup: `Destination: ${view.destination.name}` })
  }
  if (view?.driver_location) {
    markers.push({ id: 'driver', kind: 'driver', latitude: view.driver_location.latitude,
      longitude: view.driver_location.longitude,
      popup: `${view.driver?.name || 'Driver'}${view.driver?.plate_number ? ` · ${view.driver.plate_number}` : ''}` })
  }
  return markers
}
