---
description: A mission playbook for an AI agent equipped with olares-cli and Agent Skills — integrate Olares Payment into your web app, then deploy it as an installable app on your Olares cluster, with a stable domain, secrets in cluster Secrets, and a closed webhook loop.
head:
  - - meta
    - name: keywords
      content: Olares Payment, AI agent, olares-cli, Agent Skills, demo store, Olares app, chart, webhook
---

# Build with AI agents

Your AI agent can do two things for you: **integrate Olares Payment into your web app**, and **deploy it as an installable app on your Olares cluster** — stable domain, secrets in cluster Secrets, webhook loop closed.

This is not "hand the agent a link and watch it self-teach." You give it real tools and real access, then hand it a mission playbook. This page is that playbook.

## Before you start

### Tooling

The agent's "brain" is Agent Skills (each skill is an operating manual that explains what each command group does, which parameters matter, and how to recover from common errors); its "hands" are `olares-cli`. Installation and login are one-time chores — follow the official docs:

- [Install olares-cli](../cli-install) — `npx @olares/cli@latest install` sets up the CLI and Skills in one go
- [Install and use Agent Skills](../cli-agent-skills)
- [Log in to Olares](../cli-log-in)

### Two keys (done by a human, exactly once)

| Key | How | What it unlocks |
| --- | --- | --- |
| Merchant keys | [Merchant dashboard](https://www.olares.com/payment/dashboard/) → Checkouts → Advanced settings → API keys — get `pk_live_…` / `sk_live_…` / `whsec_…` | Payments |
| Cluster | `olares-cli profile login --olares-id <your Olares ID>` | Your cluster |

![Merchant dashboard: API keys and webhook registration on the same page](images/dashboard-api-keys-webhooks.png)

![olares-cli profile login: one command, logged in](images/cli-profile-login.png)

With both keys in hand, everything else can be delegated to the agent.

### Two sources of payment knowledge

<!-- Before publishing: switch both llms-full.txt links back to the production URL https://www.olares.com/docs/developer/payment/llms-full.txt (currently 404 in prod; pointing at the review site for now) -->
- **Textbook**: [llms-full.txt](https://doc-review.mdogs.me/developer/payment/llms-full.txt) — all payment docs bundled into one Markdown file. One read, and the agent knows the entire API.
- **Reference implementation**: [olares-payment-developer-example](https://github.com/beclab/olares-payment-developer-example) — the same knowledge as runnable code.

One is the textbook, the other is the answer key: the agent reads the textbook to learn the API, and follows the reference implementation to avoid mistakes.

## Mission 1: Integrate Olares Payment

A payment integration boils down to two things:

1. **Give the buyer a checkout** — `createPayment` returns a `checkoutUrl`; currency, network, and wallet connection are all handled by the hosted checkout.
2. **Confirm settlement before fulfilling** — webhooks push `payment.succeeded` in real time, or simpler: poll `getPayment` every few seconds. Both roads lead to the same place: only `paid: true` is the fulfillment signal. Webhooks suit real-time reactions; polling suits the smallest demo.

### Let the agent do the integration

Just hand it the textbook. [llms-full.txt](https://doc-review.mdogs.me/developer/payment/llms-full.txt) bundles all the payment docs — one read and the agent has the whole API: HMAC authentication, creating payments, webhook verification, error codes and retries. Then describe what you want in plain language:

> Add an order endpoint to my Node service: call `createPayment` and return the `checkoutUrl` to the frontend. Also stand up a `/webhook` that receives `payment.succeeded` and marks the order paid. Read credentials from environment variables.

It reads the docs, writes the code, runs it. You watch.

### We already built one

No need to start from zero, actually — we ran the exact process above ourselves, and the result is a complete demo store: [olares-payment-developer-example](https://github.com/beclab/olares-payment-developer-example). The full loop is in there: ordering, checkout, webhook, refunds. The `examples/` directory has one standalone script per operation, and all credentials come from environment variables. Clone it, fill in your keys, `npm install && npm start`.

In Mission 2, we'll use this exact repo for the deployment demo.

## Mission 2: Package the web app as an Olares app

Turning a web app into an Olares app means producing two artifacts: **an image** (the app itself, pushed to a public registry so nodes can pull it anonymously) and **a chart** (which tells Olares how to install it: entrance, secrets, resources).

You don't need to teach the operational details — skills like `olares-chart`, `olares-market`, and `olares-settings` already cover them: how to scaffold a chart from docker-compose, how to lint / package / upload / install, how to read app status. The agent reads the skills and knows what to do.

One more thing that's too routine to count as a "key": the image goes to a public registry, so the agent needs your local docker to be `docker login`-ed when it pushes. That's all.

What does it look like when it's done? Here's our instance: <https://dc86a2fa.olarespayment.olares.com/> — a real store running on Olares. Open it and place an order right now.

## The master prompt

With tooling and both keys ready, hand this to your agent:

```text
You are deploying my Olares Payment integration as an installable app on my
Olares cluster.

Already set up (do not redo): olares-cli + Agent Skills installed and logged
in; docker logged in to a public registry. My merchant keys are in my shell
env: PAYMENT_API_KEY / PAYMENT_API_SECRET / PAYMENT_WEBHOOK_SECRET.

Knowledge sources:
- Payment API docs (full bundle):
  https://doc-review.mdogs.me/developer/payment/llms-full.txt
- Reference implementation:
  https://github.com/beclab/olares-payment-developer-example
- Load skills: olares-shared, olares-chart, olares-market, olares-settings,
  olares-cluster.

Mission:
1. Start from the reference repo (or my existing app). Ensure:
   - secrets come from env only; nothing in code, image, or git
   - returnUrl derives from x-forwarded-proto / x-forwarded-host at runtime
   - tsx is in dependencies; start with `npx tsx server.js`
2. Write a Dockerfile (node:22-slim; COPY vendor before npm ci; USER node).
3. Scaffold the chart with `olares-cli chart from-compose`, then enforce:
   entrance authLevel public; the three secrets in manifest envs[] with
   editable: true, wired to a K8s Secret; runAsUser true; apiTimeout 60;
   supportArch from `olares-cli cluster node list` — never guess.
4. Build for the target arch with buildx, smoke-test locally, push, and verify
   anonymous pull with DOCKER_CONFIG=$(mktemp -d).
5. `olares-cli chart lint` → `chart package` → `market upload` →
   `market install <app> -s upload --env ... --watch`.
6. Print the real entrance URL from `olares-cli settings apps list`
   (the subdomain is the platform-assigned appid, NOT the app name) and
   stop — I will register the webhook in the merchant dashboard and hand
   you the new whsec_… to inject via `olares-cli settings apps env set`.
```

::: warning Key discipline
Throughout the whole flow, real keys live in exactly three places: your shell environment, the merchant dashboard, and the cluster Secret. Never write them into image layers, chart files, or git commits. If a key ever entered git history, rotate it in the merchant dashboard.
:::
