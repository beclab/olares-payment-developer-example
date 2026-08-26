export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'failed';

export interface Order {
  id: string;
  productId: string;
  productTitle: string;
  amountCents: number;
  buyerOlaresId: string;
  paymentId: string | null;
  checkoutUrl: string | null;
  status: OrderStatus;
  txHash: string | null;
  shipNote: string | null;
  createdAt: number;
  updatedAt: number;
}

const orders = new Map<string, Order>();

export function createOrder(input: Omit<Order, 'status' | 'txHash' | 'shipNote' | 'createdAt' | 'updatedAt'>): Order {
  const now = Date.now();
  const order: Order = {
    ...input,
    status: 'pending',
    txHash: null,
    shipNote: null,
    createdAt: now,
    updatedAt: now,
  };
  orders.set(order.id, order);
  return order;
}

export function getOrder(id: string): Order | undefined {
  return orders.get(id);
}

export function findOrderByPaymentId(paymentId: string): Order | undefined {
  for (const order of orders.values()) {
    if (order.paymentId === paymentId) return order;
  }
  return undefined;
}

export function patchOrder(id: string, patch: Partial<Order>): Order | undefined {
  const current = orders.get(id);
  if (!current) return undefined;
  const next = { ...current, ...patch, id: current.id, updatedAt: Date.now() };
  orders.set(id, next);
  return next;
}

export function shipOrder(id: string, txHash: string | null): Order | undefined {
  const current = orders.get(id);
  if (!current) return undefined;
  if (current.status === 'shipped') return current;
  return patchOrder(id, {
    status: 'shipped',
    txHash,
    shipNote: `Packed ${current.productTitle} for ${current.buyerOlaresId}`,
  });
}
