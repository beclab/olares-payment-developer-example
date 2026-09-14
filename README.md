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

`examples/` holds the five operations you will actually wire into your business, one script each:

| Script | What it does | In your business |
|---|---|---|
| `01-create-payment.js` | Create a payment and get the checkout link | Redirect the buyer to pay after checkout |
| `02-get-payment.js` | Check whether that payment has settled | Confirm the order when the buyer returns |
| `03-list-payments.js` | List payments | Reconciliation |
| `04-webhook.js` | Receive and verify gateway notifications | Update orders even if the buyer never returns |
| `05-create-refund.js` | Open a refund and watch its state machine | Refunds after fulfillment |

Start with [examples/README.md](./examples/README.md). The gateway address is built into the SDK — no configuration needed; the webhook script additionally needs `webhookSecret` from `config.js`. 

## Refunds

Refunds are merchant-side order management; the gateway only hosts the execution page
(the operator signs one transfer with the receive wallet — an EOA, contract wallets are
blocked there). The shop demo wires the whole loop:

- **Seller** (`/admin`, order drawer): open a refund (full remaining balance by default,
  or a partial amount in token minor units), cancel a draft, reissue an expired link.
  The execution link is shown **once** — its secret lives in the URL fragment and is
  never stored.
- **State machine**: `prepared → submitted → succeeded | failed | canceled`, one open
  refund per payment (`failed` keeps the slot so it can be retried). The shop derives
  its order rollup (`refund pending / partially refunded / refunded`) from the ledger —
  `getPayment().refundSummary` is the source of truth, `refund.succeeded|failed`
  webhooks are the fast lane.
- **Buyer** (`/`): order rows and the order view show the refund rollup plus succeeded
  refunds, and link to the hosted receipt page for the full statement.
- Amounts are token minor-unit strings end to end (BigInt, never floats).

Design notes: [docs/refund-redesign.md](./docs/refund-redesign.md); open questions and
SDK feedback items: [docs/refund-open-questions.md](./docs/refund-open-questions.md).

## Demo video

https://github.com/user-attachments/assets/730f0527-45a1-47f5-9bde-eb41bed8a42f






