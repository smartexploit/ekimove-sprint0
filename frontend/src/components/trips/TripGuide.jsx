import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  BadgeCheck, CalendarClock, CheckCircle2, CreditCard, Hourglass, KeyRound, MapPin, Navigation, PhoneCall,
  Search, Star, XCircle,
} from 'lucide-react'
import { apiRequest } from '../../services/authService.js'
import { formatNaira } from '../../utils/format.js'
import { formatPickupTime } from '../../utils/schedule.js'
import { TRIP_BOOKED_EVENT, tripStage } from '../../utils/tripStage.js'

const FAST_MS = 5000
const SLOW_MS = 30000
const SEEN_KEY = 'ekimove.tripGuideSeen'
const LIVE_KEY = 'ekimove.tripGuideLive'

function readSet(key) {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(key) || '[]'))
  } catch {
    return new Set()
  }
}

function addTo(key, value) {
  const set = readSet(key)
  set.add(value)
  try {
    sessionStorage.setItem(key, JSON.stringify([...set].slice(-60)))
  } catch {
    /* fine */
  }
}

const OPEN_RIDE = ['assigned', 'driver_arriving', 'in_progress']

function stepContent(stage, trip) {
  const delivery = trip.service_type === 'delivery'
  const driver = trip.driver_name || (delivery ? 'Your rider' : 'Your driver')
  const who = delivery ? 'rider' : 'driver'
  const pay = formatNaira(trip.amount_to_pay ?? trip.quoted_fare, { decimals: 0 })
  const myRides = `/my-rides#ride-${trip.id}`
  switch (stage) {
    case 'scheduled':
      return { Icon: CalendarClock, step: 1, title: 'Ride booked', tone: 'calm',
        text: `We'll start finding your ${who} shortly before ${formatPickupTime(trip.scheduled_for)}. You'll get a notification.`,
        action: ['See my rides', myRides] }
    case 'searching':
      return { Icon: Search, step: 1, title: `Finding your ${who}…`, tone: 'calm', pulse: true,
        text: trip.drivers_notified > 0
          ? `Your request is ringing on ${trip.drivers_notified} nearby ${who}${trip.drivers_notified === 1 ? '' : 's'}' phone${trip.drivers_notified === 1 ? '' : 's'}. Please stay on this screen; it usually takes under a minute.`
          : `We're looking for a free ${who} near ${trip.origin_text}. Please wait a moment.`,
        action: ['View request', myRides] }
    case 'manual':
      return { Icon: Hourglass, step: 1, title: `Still finding a ${who}`, tone: 'warn',
        text: `No ${who} has accepted yet, so the EkiMove team is assigning one for you. You can wait, or cancel from My rides.`,
        action: ['View request', myRides] }
    case 'pay':
      return { Icon: CreditCard, step: 2, title: `${driver} accepted your ${delivery ? 'delivery' : 'ride'}!`, tone: 'go',
        text: `Next: pay ${pay} so ${driver} can start. ${trip.vehicle_plate ? `Plate number: ${trip.vehicle_plate}.` : ''}`,
        action: [`Pay ${pay} now`, `/payments?rideId=${trip.assigned_ride_id}`] }
    case 'confirming':
      return { Icon: Hourglass, step: 2, title: 'Confirming your payment', tone: 'calm',
        text: `We're checking your transfer. ${driver} is on the way; this usually takes a minute or two.`,
        action: ['View trip', myRides] }
    case 'coming':
      return { Icon: Navigation, step: 3, title: `${driver} is on the way`, tone: 'go',
        text: `Be ready at ${trip.origin_text}. When they arrive, check the plate${trip.vehicle_plate ? ` (${trip.vehicle_plate})` : ''}, then give your pickup PIN${trip.pickup_pin ? ` ${trip.pickup_pin}` : ''}.`,
        action: ['Track on the map', myRides], callHint: true }
    case 'arrived':
      return { Icon: KeyRound, step: 4, title: `${driver} has arrived`, tone: 'go', big: trip.pickup_pin,
        text: `Check the plate${trip.vehicle_plate ? ` is ${trip.vehicle_plate}` : ''}. Only then, tell ${driver} your pickup PIN to start the ${delivery ? 'delivery' : 'trip'}.`,
        action: ['Open trip', myRides], callHint: true }
    case 'onway':
      return { Icon: MapPin, step: 5, title: delivery ? 'Your package is on the way' : 'Enjoy your trip', tone: 'go',
        text: delivery
          ? `${driver} is taking it to ${trip.destination_text}. The recipient gives the rider their delivery code to finish.`
          : `Heading to ${trip.destination_text}. Share your trip with family, and use SOS if anything feels wrong.`,
        action: ['Open trip', myRides] }
    case 'rate':
      return { Icon: Star, step: 6, title: delivery ? 'Delivered!' : 'You’ve arrived!', tone: 'go',
        text: `Thanks for moving with EkiMove. How was ${driver}? Your rating helps keep EkiMove safe.`,
        action: [`Rate ${driver}`, myRides] }
    case 'done':
      return { Icon: CheckCircle2, step: 6, title: 'Trip complete', tone: 'go', text: 'Thanks for moving with EkiMove.',
        action: ['Book another', '/book-ride'] }
    case 'cancelled':
      return { Icon: XCircle, step: null, title: `${delivery ? 'Delivery' : 'Ride'} cancelled`, tone: 'warn',
        text: trip.refund_status === 'due'
          ? 'Your refund is being processed. You’ll see it in Payments.'
          : 'This booking was cancelled. You can book again any time.',
        action: ['Book again', delivery ? '/send-package' : '/book-ride'] }
    default:
      return null
  }
}

const STEPS = ['Request', 'Pay', 'On the way', 'Pickup', 'Trip', 'Done']

/**
 * Walks the passenger through their trip: a pop-up for each new step
 * (finding a driver, pay, driver on the way, arrived, on the trip, rate),
 * then a small bar to reopen it.
 */
export default function TripGuide() {
  const location = useLocation()
  const [trip, setTrip] = useState(null)
  const [open, setOpen] = useState(false)
  const lastKey = useRef('')
  const timer = useRef(null)

  const pick = useCallback((list) => {
    const live = readSet(LIVE_KEY)
    const openOne = list.find((t) => t.service_type !== 'haulage'
      && (t.status === 'requested' || OPEN_RIDE.includes(t.ride_status)))
    if (openOne) {
      addTo(LIVE_KEY, openOne.id)
      return openOne
    }
    // A trip we watched end in this session (finished or cancelled).
    return list.find((t) => live.has(t.id) && ['rate', 'cancelled'].includes(tripStage(t))) || null
  }, [])

  useEffect(() => {
    let stopped = false
    const run = async () => {
      window.clearTimeout(timer.current)
      let next = null
      try {
        const list = await apiRequest('/api/v1/ride-requests/my-rides')
        next = Array.isArray(list) ? pick(list) : null
      } catch {
        /* try again shortly */
      }
      if (stopped) return
      setTrip(next)
      const stage = tripStage(next)
      if (next && stage) {
        const key = `${next.id}:${stage}`
        if (key !== lastKey.current) {
          lastKey.current = key
          if (!readSet(SEEN_KEY).has(key)) {
            setOpen(true)
            if (stage !== 'searching') navigator.vibrate?.([200, 100, 200])
          }
        }
      } else {
        setOpen(false)
      }
      const fast = next && !['rate', 'cancelled', 'done'].includes(stage)
      const again = () => {
        if (stopped) return
        if (document.visibilityState === 'visible') run()
        else timer.current = window.setTimeout(again, FAST_MS)
      }
      timer.current = window.setTimeout(again, fast ? FAST_MS : SLOW_MS)
    }
    run()
    const onVisible = () => document.visibilityState === 'visible' && run()
    window.addEventListener(TRIP_BOOKED_EVENT, run)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearTimeout(timer.current)
      window.removeEventListener(TRIP_BOOKED_EVENT, run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pick])

  const stage = tripStage(trip)
  const content = trip && stage ? stepContent(stage, trip) : null
  if (!content) return null

  const dismiss = () => {
    addTo(SEEN_KEY, `${trip.id}:${stage}`)
    setOpen(false)
  }
  const [label, to] = content.action
  const onPaymentPage = location.pathname.startsWith('/payments') && stage === 'pay'

  if (!open || onPaymentPage) {
    if (['done'].includes(stage)) return null
    return (
      <button type="button" className={`trip-bar is-${content.tone}`} onClick={() => setOpen(true)}>
        <content.Icon size={18} aria-hidden="true" />
        <span className="trip-bar-text">{content.title}</span>
        <span className="trip-bar-cta">Next step</span>
      </button>
    )
  }

  return (
    <div className="trip-guide-backdrop" role="presentation" onClick={dismiss}>
      <section className={`trip-guide is-${content.tone}`} role="dialog" aria-modal="true" aria-labelledby="trip-guide-title"
        onClick={(event) => event.stopPropagation()}>
        {content.step && (
          <ol className="trip-steps" aria-label={`Step ${content.step} of ${STEPS.length}`}>
            {STEPS.map((name, i) => (
              <li key={name} className={i + 1 < content.step ? 'is-done' : i + 1 === content.step ? 'is-now' : ''}>
                <span className="sr-only">{name}</span>
              </li>
            ))}
          </ol>
        )}
        <span className={`trip-guide-icon ${content.pulse ? 'is-pulsing' : ''}`} aria-hidden="true">
          <content.Icon size={30} />
        </span>
        <h2 id="trip-guide-title">{content.title}</h2>
        {content.big && (
          <p className="trip-guide-pin" aria-label={`Pickup PIN ${content.big.split('').join(' ')}`}>{content.big}</p>
        )}
        <p className="trip-guide-text">{content.text}</p>
        <p className="trip-guide-route">{trip.origin_text} → {trip.destination_text}</p>
        {content.callHint && (
          <p className="trip-guide-hint"><PhoneCall size={15} aria-hidden="true" /> You can call or message {trip.driver_name || 'them'} from the trip.</p>
        )}
        <div className="trip-guide-actions">
          <Link className="btn btn-primary btn-lg btn-block" to={to} onClick={dismiss}>
            {stage === 'pay' && <BadgeCheck size={18} aria-hidden="true" />} {label}
          </Link>
          <button type="button" className="btn btn-quiet btn-block" onClick={dismiss}>Got it</button>
        </div>
      </section>
    </div>
  )
}
