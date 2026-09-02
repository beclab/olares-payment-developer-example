# @olares/payment-sdk

Olares Payment 是面向商户的收款网关。商户在 Dashboard 配置收款钱包并取得 API 密钥后，即可创建支付、引导买家进入托管收银台，并在链上结算完成后履约。

本包是网关的官方 TypeScript 客户端，供 **Node.js 服务端** 使用。请求以 HMAC 签名，密钥不得进入浏览器或其他不受信任的运行时。

完整的方法说明、参数与错误码见 [sdk.md](./sdk.md)。

## Requirements

- Node.js 18 或更高版本
- 商户 API Key（`pk_`）与 Secret（`sk_`）
- 网关 `baseUrl`（测试环境或自建部署地址）

Webhook 验签另需 Dashboard 登记端点时下发的 `whsec_`。该值只展示一次。

## Installation

```bash
npm install @olares/payment-sdk
```

## Usage

使用 `MerchantClient`。收款账户由密钥绑定，无需在请求中指定。

```ts
import { MerchantClient } from '@olares/payment-sdk';

const client = new MerchantClient({
  apiKey: process.env.PAYMENT_API_KEY!,
  apiSecret: process.env.PAYMENT_API_SECRET!,
  baseUrl: process.env.PAYMENT_ENDPOINT!,
});
```

### Creating a payment

`createPayment` 创建一笔支付并返回托管收银台 URL。将 `checkoutUrl` 提供给买家即可完成付款。

```ts
const { paymentId, checkoutUrl } = await client.createPayment({
  amountCents: 1999,
  returnUrl: 'https://merchant.example/orders/ord_123',
  metadata: { order_id: 'ord_123' },
});
```

`amountCents` 为以美分为单位的计价金额（`1999` 表示 $19.99）。`returnUrl` 为支付完成后的回跳地址，可省略。

买家身份可选。省略 `buyer` 即为匿名订单。若需在 Dashboard 对账，可传入商户侧用户标识：

```ts
await client.createPayment({
  amountCents: 1999,
  buyer: {
    kind: 'external',
    ref: 'user_8817',
    display: { name: 'Ada' },
  },
});
```

同一业务单请使用稳定的幂等键，避免重试产生重复支付：

```ts
await client.createPayment(params, { idempotencyKey: `order:ord_123` });
```

### Confirming a payment

支付是否完成以 `getPayment` 的 `paid` 为准（状态为成功且存在链上 `txHash`）。也可登记 Webhook，在 `payment.succeeded` 时履约。请求体必须为原始字节。

```ts
import { webhooks } from '@olares/payment-sdk';

const result = await client.getPayment(paymentId);
if (result.paid) {
  const { txHash } = result.credential;
}

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const event = webhooks.constructEvent(req, process.env.PAYMENT_WEBHOOK_SECRET!);
  if (event.type === 'payment.succeeded') {
    // event.paymentId, event.credential.txHash
  }
  res.status(200).send('ok');
});
```

## Documentation

- [sdk.md](./sdk.md) — `MerchantClient` 构造参数、网关方法一览与错误处理
