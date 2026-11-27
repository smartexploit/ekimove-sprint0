/** Send the customer to Interswitch's secure checkout page (web redirect). */

const CHECKOUT_HOSTS = ['newwebpay-sandbox.interswitchng.com', 'newwebpay.interswitchng.com']

/**
 * checkout: what the API returned (merchant_code, pay_item_id, txn_ref, amount, redirect_url…).
 * returnPath: where Interswitch sends the customer back, e.g. "/travel?ticket=12".
 */
export function goToInterswitch(checkout, { returnPath, itemName, customerName = '', customerId = '' }) {
  const target = new URL(checkout.redirect_url)
  if (target.protocol !== 'https:' || !CHECKOUT_HOSTS.includes(target.hostname)
      || target.pathname !== '/collections/w/pay') {
    throw new Error('Invalid Interswitch redirect address.')
  }
  const fields = {
    merchant_code: checkout.merchant_code,
    pay_item_id: checkout.pay_item_id,
    site_redirect_url: new URL(returnPath, window.location.origin).toString(),
    txn_ref: checkout.txn_ref,
    amount: String(checkout.amount),
    currency: checkout.currency || '566',
    cust_email: checkout.customer_email,
    cust_name: customerName,
    cust_id: String(customerId),
    pay_item_name: itemName,
    payment_response_type: 'GET',
  }
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = target.toString()
  form.style.display = 'none'
  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = String(value ?? '')
    form.appendChild(input)
  })
  document.body.appendChild(form)
  form.submit()
}
