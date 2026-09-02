# olares-payment-developer-example

Use the SDK to collect stablecoins, and see how to put that on your own server.

## Run

1. Open the [Olares Payment Dashboard](https://www.olares.com/payment/dashboard/), sign in, then **Checkouts → Advanced settings**. Copy the API key and secret.
2. Paste them into `config.js` (`apiKey`, `apiSecret`).
3. `npm install && npm start` → http://127.0.0.1:32000

## Four SDK scripts

[examples/README.md](./examples/README.md) — one file each: `createPayment`, `getPayment`, `listPayments`, webhook `constructEvent`.

---

## Integrate

Your server owns the order. The gateway only sees the amount and a `checkoutUrl`.

1. **`createPayment`** — `amountCents`, `returnUrl`, `metadata.order_id`. Send the buyer to `checkoutUrl`.
2. **`getPayment`** on return — treat `paid: true` as the only safe signal to mark the order paid.
3. **Webhook** — `webhooks.constructEvent` on the raw body. `payment.succeeded` / `failed` / `canceled` keep the order in sync if the buyer never comes back.
4. **`listPayments`** — reconcile against the gateway ledger.

Paid means the gateway has the funds. Shipping (or any other fulfillment) stays on your side.
