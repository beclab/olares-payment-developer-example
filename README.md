# olares-payment-developer-example

This project shows how to integrate Olares Payment into your own server to collect stablecoin payments.
A minimal shop demo: sign-in, orders, payment — nothing more.

## Prerequisites

- Node.js 18 or higher
- An olaresId — used to sign in to the Olares Payment Dashboard and enable payments

## Run

1. Open the [Olares Payment Dashboard](https://www.olares.com/payment/dashboard/), sign in with your olaresId, go to **Checkouts → Advanced settings**, and copy the API key and secret.

2. Paste the key and secret into `config.js` — minimal changes needed:

   ```js
   export const CONFIG = {
     port: 32000,
     shopPublicUrl: 'http://127.0.0.1:32000',
     apiKey: 'pk_live_…',    // ← paste the API key
     apiSecret: 'sk_live_…', // ← paste the secret
     webhookSecret: 'whsec_…',
   };
   ```

3. Start it:

   ```bash
   npm install && npm start
   ```

   Open http://127.0.0.1:32000 — a small shop: a buyer signs in, places an order, is redirected to the Olares checkout; after paying, they return and the order shows as paid.

## Examples

`examples/` holds the four operations you will actually wire into your business, one script each:

| Script | What it does | In your business |
|---|---|---|
| `01-create-payment.js` | Create a payment and get the checkout link | Redirect the buyer to pay after checkout |
| `02-get-payment.js` | Check whether that payment has settled | Confirm the order when the buyer returns |
| `03-list-payments.js` | List payments | Reconciliation |
| `04-webhook.js` | Receive and verify gateway notifications | Update orders even if the buyer never returns |

Start with [examples/README.md](./examples/README.md). The gateway address is built into the SDK — no configuration needed; the webhook script additionally needs `webhookSecret` from `config.js`. 

## Demo video

<video src="./video-demo.mp4" controls playsinline title="Harbor Goods shop demo"></video>
