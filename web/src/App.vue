<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

interface Product {
  id: string;
  title: string;
  blurb: string;
  priceCents: number;
}

interface Order {
  id: string;
  productTitle: string;
  amountCents: number;
  buyerOlaresId: string;
  status: 'pending' | 'paid' | 'shipped' | 'failed';
  txHash: string | null;
  shipNote: string | null;
}

const products = ref<Product[]>([]);
const buyerOlaresId = ref('alice.olares.com');
const busyId = ref<string | null>(null);
const error = ref('');
const modal = ref<'checkout' | 'waiting' | 'shipped' | 'failed' | null>(null);
const order = ref<Order | null>(null);
let pollTimer: number | undefined;

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function loadProducts(): Promise<void> {
  const resp = await fetch('/api/products');
  const data = (await resp.json()) as { products: Product[] };
  products.value = data.products;
}

async function refreshOrder(id: string): Promise<Order | null> {
  const resp = await fetch(`/api/orders/${id}`);
  if (!resp.ok) return null;
  const data = (await resp.json()) as { order: Order };
  order.value = data.order;
  return data.order;
}

function stopPoll(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startPoll(id: string): void {
  stopPoll();
  pollTimer = window.setInterval(async () => {
    const next = await refreshOrder(id);
    if (next?.status === 'shipped') {
      modal.value = 'shipped';
      stopPoll();
    } else if (next?.status === 'failed') {
      modal.value = 'failed';
      stopPoll();
    }
  }, 1500);
}

async function buy(product: Product): Promise<void> {
  error.value = '';
  if (!buyerOlaresId.value.trim()) {
    error.value = 'Enter a buyer olares id first.';
    return;
  }
  busyId.value = product.id;
  modal.value = 'checkout';
  try {
    const resp = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: product.id, buyerOlaresId: buyerOlaresId.value.trim() }),
    });
    const data = (await resp.json()) as { checkoutUrl?: string; order?: Order; error?: string };
    if (!resp.ok || !data.checkoutUrl) {
      throw new Error(data.error || 'checkout failed');
    }
    order.value = data.order ?? null;
    window.location.href = data.checkoutUrl;
  } catch (err) {
    modal.value = 'failed';
    error.value = err instanceof Error ? err.message : 'checkout failed';
  } finally {
    busyId.value = null;
  }
}

function closeModal(): void {
  stopPoll();
  modal.value = null;
  const url = new URL(window.location.href);
  url.searchParams.delete('order');
  window.history.replaceState({}, '', url.pathname);
}

onMounted(async () => {
  await loadProducts();
  const id = new URLSearchParams(window.location.search).get('order');
  if (!id) return;
  modal.value = 'waiting';
  const next = await refreshOrder(id);
  if (next?.status === 'shipped') {
    modal.value = 'shipped';
    return;
  }
  if (next?.status === 'failed') {
    modal.value = 'failed';
    return;
  }
  startPoll(id);
});

onUnmounted(stopPoll);
</script>

<template>
  <main class="page">
    <header class="hero">
      <p class="kicker">Harbor Goods</p>
      <h1>A small shop that collects through Olares Payment</h1>
      <p class="lede">
        Mode A: this backend holds a merchant API key, creates a payment, and ships when the
        gateway webhook arrives.
      </p>
      <label class="buyer">
        Buyer olares id
        <input v-model="buyerOlaresId" type="text" autocomplete="off" />
      </label>
      <p v-if="error" class="err">{{ error }}</p>
    </header>

    <section class="grid">
      <article v-for="p in products" :key="p.id" class="card">
        <h2>{{ p.title }}</h2>
        <p>{{ p.blurb }}</p>
        <div class="row">
          <strong>{{ usd(p.priceCents) }}</strong>
          <button type="button" :disabled="busyId === p.id" @click="buy(p)">
            {{ busyId === p.id ? 'Opening checkout…' : 'Buy' }}
          </button>
        </div>
      </article>
    </section>

    <div v-if="modal" class="overlay" @click.self="modal !== 'checkout' && closeModal()">
      <aside class="dialog">
        <p class="kicker">{{ modal }}</p>
        <template v-if="modal === 'checkout'">
          <h3>Opening the payment checkout</h3>
          <p>You will leave this shop for the Olares Payment hosted page.</p>
        </template>
        <template v-else-if="modal === 'waiting'">
          <h3>Waiting for the webhook</h3>
          <p v-if="order">Order {{ order.id }} · {{ order.productTitle }}</p>
          <p>The gateway will notify this shop when the payment succeeds, then we ship.</p>
        </template>
        <template v-else-if="modal === 'shipped'">
          <h3>Paid. Shipped.</h3>
          <p v-if="order">{{ order.shipNote || order.productTitle }}</p>
          <p v-if="order?.txHash" class="mono">tx {{ order.txHash }}</p>
        </template>
        <template v-else>
          <h3>Could not complete</h3>
          <p>{{ error || 'Payment or webhook failed.' }}</p>
        </template>
        <button v-if="modal !== 'checkout'" type="button" class="ghost" @click="closeModal">Close</button>
      </aside>
    </div>
  </main>
</template>
