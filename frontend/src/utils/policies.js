// EkiMove policies. Keep POLICY_VERSION in step with POLICY_VERSION in
// app/verification.py: bumping both asks everyone to accept again.
export const POLICY_VERSION = '2026-11-01'
export const POLICY_EFFECTIVE = '1 November 2026'

export const POLICIES = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    summary: 'The agreement between you and EkiMove for using the app.',
    sections: [
      ['Who we are', [
        'EkiMove is a ride-booking and load-moving platform for Ekiti State, Nigeria. The app connects passengers and customers with independent, verified drivers.',
        'By creating an account or using EkiMove, you agree to these Terms, our Privacy Policy, our Community & Safety Guidelines and our Cancellation & Refund Policy. Drivers also agree to the Driver Agreement.',
      ]],
      ['Your account', [
        'You must be at least 18 years old and give accurate details, including your real name and a phone number or email address you control.',
        'Keep your password private. You are responsible for activity on your account. Tell us at once through Support if you think someone else has used it.',
        'One person, one account. Accounts cannot be sold or transferred.',
      ]],
      ['Booking and fares', [
        'Ride fares are fixed in advance for each approved route and vehicle and are shown before you book. A second motorcycle passenger, where allowed, costs the extra charge shown in the app.',
        'Loads (big cars, vans and dyna trucks) are priced by a quote agreed with EkiMove support. A quote is only binding once you accept it in the app.',
        'EkiMove offers your request to available drivers but cannot guarantee that a driver will be found or how long it will take.',
      ]],
      ['Package deliveries', [
        'You can send a package within our service areas. You must describe it honestly, pack it securely, mark it fragile where needed, and give a recipient who can receive it.',
        'Packages must not contain cash, weapons, drugs, stolen goods, dangerous or banned items, or anything illegal. Riders may refuse a package that looks unsafe or doesn’t match its description, and we may report illegal items to the police.',
        'The rider hands the package over only when the recipient gives the 4-digit delivery code. Keep the code private until the package is in the recipient’s hands.',
        'Report a lost or damaged package through Support within 24 hours of the delivery time. Any compensation is limited and assessed case by case.',
      ]],
      ['Booking ahead, promo and invite codes', [
        'You can book a ride up to 7 days ahead. EkiMove starts looking for a driver shortly before your pickup time but cannot guarantee one will be available.',
        'Promo and invite codes give money off the fare shown in the app. They have no cash value, can’t be swapped or sold, and may have limits and end dates. A code used on a booking that is cancelled before payment can be used again.',
        'We may cancel codes or invite rewards that are misused, for example through fake or duplicate accounts.',
      ]],
      ['Payment', [
        'EkiMove is cashless. Pay only through the methods shown in the app (bank transfer to the account shown in the app, or card through our payment partners). Never pay a driver directly or in cash.',
        'A trip starts only after its payment is confirmed. A screenshot is not proof of payment.',
        'Refunds and cancellation fees follow our Cancellation & Refund Policy.',
      ]],
      ['Safety features', [
        'Every trip has a pickup PIN, shown in the passenger’s app. Give it to the driver only once you are with them and the plate matches.',
        'You can share a live link to your trip with someone you trust, and use SOS on a live trip to alert EkiMove. In an emergency, call 112 first.',
      ]],
      ['Conduct and enforcement', [
        'Everyone must follow the Community & Safety Guidelines. We may warn, suspend or remove accounts that break them, give false information, misuse payments or put others at risk. Serious cases may be reported to the police.',
      ]],
      ['Our responsibility', [
        'We work to keep EkiMove safe and available, but the app is provided as it is and may sometimes be unavailable. To the extent the law allows, EkiMove is not liable for indirect losses or for events outside our reasonable control. Nothing in these Terms limits rights you have under Nigerian consumer protection law.',
      ]],
      ['Changes and law', [
        'We may update these Terms. If a change is important, we will ask you to accept the new version in the app before you continue.',
        'These Terms are governed by the laws of the Federal Republic of Nigeria.',
        'Questions or complaints: use Support in the app or the contacts shown on our website.',
      ]],
    ],
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    summary: 'What personal data we collect, why, who we share it with, and your rights under the Nigeria Data Protection Act 2023.',
    sections: [
      ['What we collect', [
        'Account details: your name, the phone number and/or email you sign in with, whether you have confirmed them with a code, and your password (stored only in a scrambled, one-way form).',
        'Trip details: pickups, destinations, booked pickup times, fares and discounts, vehicle, ratings, cancellations, messages between you and your driver in the trip chat, and messages with Support.',
        'Places you save (such as Home or Work) and who invited you to EkiMove, if anyone.',
        'Payment records: amounts, methods and references. We do not store card numbers; card payments are handled by our payment partners.',
        'Identity checks: passengers who verify their ID give the ID type, number and a photo of it. Drivers give a face photo and vehicle details.',
        'Location: drivers share their phone’s location while they are online, so we can offer them nearby trips and show passengers their driver approaching. During a trip we keep the driver’s route (the trip’s GPS trail). Passengers’ phones do not share GPS location with EkiMove.',
        'Security records: when you sign in, we record the time, IP address and device type.',
        'Emergency contact: the name and number you choose to add.',
      ]],
      ['Why we use it', [
        'To run the service you ask for: bookings, matching drivers, payments, payouts, receipts and support (performance of a contract).',
        'To keep people safe and prevent fraud: identity checks, pickup PINs, trip trails, sign-in records, ratings and safety reports (legitimate interests and legal obligations).',
        'To meet legal, tax and accounting duties.',
        'We do not sell your personal data.',
      ]],
      ['Who sees it', [
        'Your driver sees your first name and last initial, pickup and destination, and whether your ID is verified. Passengers see their driver’s first name and last initial, vehicle and plate number, rating and live location during the trip.',
        'Anyone you send a trip-sharing link to can see that trip’s status, driver details and map until two hours after it ends, or until you stop sharing.',
        'EkiMove staff see what they need to run and protect the service, including ID photos and trip trails, and every review is recorded.',
        'Service providers that process data for us: payment partners (Paystack, Interswitch), photo storage (Cloudinary), hosting (Render), maps (OpenStreetMap or Geoapify), text-message and email providers (to send sign-in and reset codes), your phone’s notification service (if you turn notifications on), error monitoring (without your name or contact details) and, if you use the Atọ́nà assistant, an AI provider that processes your chat messages to reply.',
        'Authorities, when the law requires it or to protect someone’s safety.',
      ]],
      ['How long we keep it', [
        'You can download a copy of your data or ask us to delete your account from your profile at any time. We keep account, trip, payment and safety records for as long as your account is open and afterwards for as long as needed for safety, legal and accounting purposes. If an account is removed, we erase the name, phone number and sign-in but keep trip and payment records in anonymised form.',
      ]],
      ['Your rights', [
        'Under the Nigeria Data Protection Act 2023 you can ask to see, correct or delete your data, object to some uses, or ask for a copy. Some records must be kept for legal reasons.',
        'Message Support in the app to make a request. If you are unhappy with our answer, you can complain to the Nigeria Data Protection Commission (NDPC).',
      ]],
      ['Security', [
        'We use encrypted connections, private storage for ID and driver photos, scrambled passwords, automatic sign-out after a period of inactivity, and access records for staff.',
        'The app keeps your sign-in only for the current browser session on your device.',
      ]],
    ],
  },
  {
    slug: 'community',
    title: 'Community & Safety Guidelines',
    summary: 'How everyone on EkiMove is expected to behave.',
    sections: [
      ['Respect everyone', [
        'No harassment, threats, violence, discrimination or sexual comments. No touching without consent.',
        'Keep calls and messages about the trip.',
      ]],
      ['Stay safe on every trip', [
        'Passengers: check the driver’s name, photo, vehicle and plate before you get in, and only then give the pickup PIN.',
        'Drivers: start a trip only after the passenger gives you the correct PIN in person. Drive within the law, never under the influence of alcohol or drugs, and do not use a phone while moving.',
        'On motorcycles, rider and passenger must wear helmets. Never carry more passengers than the booking allows.',
        'Share your trip with someone you trust. In an emergency call 112, then use SOS in the app.',
      ]],
      ['Keep it on EkiMove', [
        'All trips and payments go through the app. Cash, off-app trips and side deals are not allowed, because they remove the safety protections for both sides.',
      ]],
      ['What you can’t carry', [
        'No weapons, illegal drugs, stolen goods, dangerous or banned items, in a vehicle, a load or a package. Packages must not contain cash. Loads and packages must match what was described when booking.',
      ]],
      ['Reporting and action', [
        'Report problems through Support, SOS or “Report a problem” on your receipt. We review every report.',
        'Breaking these guidelines can lead to a warning, suspension or removal from EkiMove, and serious cases may be reported to the police.',
      ]],
    ],
  },
  {
    slug: 'cancellations',
    title: 'Cancellation & Refund Policy',
    summary: 'When cancelling is free, when a fee applies, and how refunds work.',
    sections: [
      ['Passengers', [
        'Cancelling is free before a driver is assigned, and for a short time after (shown in the app, currently 2 minutes).',
        'After that, while the driver is on the way, a fixed cancellation fee applies to a paid ride (shown before you confirm; currently ₦200 for a motorcycle and ₦500 for a car). It pays the driver for their time, minus EkiMove’s commission. The rest of your payment is refunded.',
        'If your ride is not yet paid, cancelling is free.',
        'A trip that has started cannot be cancelled in the app. Use SOS or Support if something is wrong.',
      ]],
      ['Loads', [
        'Cancelling or declining before you accept a quote is free. After you accept and a driver is assigned, the passenger rules above apply.',
      ]],
      ['Refunds', [
        'Refunds go back to the account you paid from, usually within 3 working days. You can see the status in My rides.',
        'Money sent for a ride that was already cancelled, or a wrong amount, is refunded after we check it.',
        'If you think you were charged wrongly, report it through Support within 7 days of the trip.',
      ]],
    ],
  },
  {
    slug: 'driver',
    title: 'Driver Agreement',
    summary: 'Extra terms for drivers who use EkiMove.',
    drivers: true,
    sections: [
      ['Your status', [
        'Unless you have a separate written contract with EkiMove, you use EkiMove as an independent driver, not as an employee. You choose when to go online and which offered trips to accept.',
      ]],
      ['Requirements', [
        'Hold a valid driver’s licence for your vehicle, keep the vehicle roadworthy, registered and insured as the law requires, and keep your details and plate number accurate.',
        'Pass EkiMove’s review before going online. We may ask you to re-verify at any time.',
      ]],
      ['Trips', [
        'Accept only trips you can complete. Start a trip only with the passenger present and the correct pickup PIN, and follow the Community & Safety Guidelines.',
        'Your phone shares its location while you are online and during trips, so passengers can see you approaching and EkiMove can keep a record of each trip’s route.',
        'Never take cash or arrange trips outside EkiMove.',
      ]],
      ['Earnings and payouts', [
        'For each completed, paid trip you earn the fare minus EkiMove’s commission (shown in the app; currently 10%). Kept cancellation fees are split the same way.',
        'Your balance is paid to the bank account in your Earnings page once it reaches the payout minimum shown there. Failed payouts are returned to your balance.',
      ]],
      ['Ratings, suspension and removal', [
        'Passengers rate trips. Low ratings, safety reports, fraud, cash or off-app trips, or breaking these terms can lead to suspension or removal. You can contact Support to discuss any decision.',
      ]],
    ],
  },
]

export function policyBySlug(slug) {
  return POLICIES.find((policy) => policy.slug === slug)
}
