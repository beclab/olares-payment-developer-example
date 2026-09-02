# API Reference

`@olares/payment-sdk` 通过 HMAC 调用网关 `POST /api/{method}`。本文说明 `MerchantClient` 的构造、方法与错误。入门见 [README.md](./README.md)。

公开类型为 camelCase，支付单标识为 `paymentId`。线上 JSON 仍使用 proto 的 `json_name`（如 `intent_id`），由 SDK 在边界处转换。

---

## Client

```ts
import { MerchantClient } from '@olares/payment-sdk';

const client = new MerchantClient({
  apiKey: process.env.PAYMENT_API_KEY!,
  apiSecret: process.env.PAYMENT_API_SECRET!,
  baseUrl: process.env.PAYMENT_ENDPOINT!,
});
```

### ClientOptions

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `apiKey` | `string` | — | 商户公钥，形如 `pk_live_…`。HMAC 方法必填。 |
| `apiSecret` | `string` | — | 商户密钥，形如 `sk_live_…`。仅用于签名，不得下发客户端。 |
| `baseUrl` | `string` | `http://localhost:31000` | 网关根地址，不含 `/api`。 |
| `timeoutMs` | `number` | `30000` | 单次 HTTP 超时（毫秒），亦用于直连 RPC 核验。 |
| `logger` | `SdkLogger` | `console` | `(level, msg, ctx?) => void`。传入 `() => {}` 可关闭日志。 |
| `rpcUrl` | `string` | — | 配置后，`verifyTransaction` 直连该 EVM RPC 的 `eth_getTransactionReceipt`，不再走网关。 |

`baseUrl` 不要带尾斜杠以外的路径。密钥与环境一一对应：测试与生产应使用不同实例。

### Multiple instances

可为不同环境或用途构造多个 client，彼此独立。

```ts
const live = new MerchantClient({
  apiKey: process.env.PAYMENT_LIVE_KEY!,
  apiSecret: process.env.PAYMENT_LIVE_SECRET!,
  baseUrl: 'https://api.example.com',
  timeoutMs: 15_000,
  logger: () => {},
});

const staging = new MerchantClient({
  apiKey: process.env.PAYMENT_TEST_KEY!,
  apiSecret: process.env.PAYMENT_TEST_SECRET!,
  baseUrl: 'https://api-test.example.com',
});

const withRpc = new MerchantClient({
  apiKey: process.env.PAYMENT_API_KEY!,
  apiSecret: process.env.PAYMENT_API_SECRET!,
  baseUrl: process.env.PAYMENT_ENDPOINT!,
  rpcUrl: process.env.EVM_RPC_URL,
});
```

---

## Gateway methods

`MerchantClient` 覆盖网关中商户密钥可调用的接口。

| SDK 方法 | 网关 | 说明 |
|---|---|---|
| `createPayment` | `POST /api/createPayment` | 创建支付，一步返回收银台 URL。收款账户由密钥推断。 |
| `getPayment` | `POST /api/getPayment` | 查询支付，并给出履约判断 `paid`。 |
| `listPayments` | `POST /api/listPayments` | 支付列表，按 `created_at` 倒序，keyset 分页。 |
| `listChannels` | `POST /api/listChannels` | 收款通道；onchain 通道附带收款钱包。 |
| `listReceiveWalletTransactions` | `POST /api/listReceiveWalletTransactions` | 收款钱包链上流水，按 `blockNumber` 倒序。 |
| `listPaymentMethodConfigs` | `POST /api/listPaymentMethodConfigs` | 当前账户的收款方式配置。 |
| `upsertOnchainPmc` | `POST /api/upsertOnchainPmc` | 覆盖写入 onchain 收款钱包（链、地址、代币白名单）。 |
| `listSupportedChains` | `POST /api/listSupportedChains` | 官方支持的链与代币，只读。 |
| `getAccount` | `POST /api/getAccount` | 密钥绑定的商户账户。 |
| `clientInfo` | `POST /api/clientInfo` | 密钥类别与绑定账户（需 HMAC）。 |
| `ping` | `POST /api/ping` | 健康检查，返回服务器时间。 |
| `verifyTransaction` | `POST /api/verifyTx` 或直连 RPC | 按交易哈希读取 EVM receipt。 |

Webhook 端点在 Dashboard 登记。SDK 提供 `webhooks.constructEvent` 做验签与解析，不发起网关请求。

建单可附加 `Idempotency-Key`：

```ts
await client.createPayment(params, { idempotencyKey: 'order:ord_123' });
```

键由调用方按业务身份派生并在重试时复用。命中则返回首次结果；相同键、不同请求体将失败。SDK 不会自动生成该键。

---

## createPayment

```ts
createPayment(
  params: CreatePaymentRequest,
  opts?: { idempotencyKey?: string },
): Promise<CreatePaymentResult>
```

### CreatePaymentRequest

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `amountCents` | `number` | 是 | 计价金额，单位美分。`1000` 表示 $10.00。 |
| `currency` | `'usd'` | 否 | 计价币种，默认 `usd`。 |
| `returnUrl` | `string` | 否 | 支付完成后的绝对 `http(s)` URL。省略则收银台不回跳。 |
| `metadata` | `Record<string, unknown>` | 否 | 透传字段，出现在查询、列表与 Webhook 中，便于对账。 |
| `buyer` | `BuyerRef` | 否 | 买家披露。省略为匿名订单。 |

### BuyerRef

三档互斥。混用或半披露由网关以 `1100` 拒绝。

| `kind` | 字段 | 网关行为 |
|---|---|---|
| 省略 `buyer` | — | 匿名。不建身份、不建账户。 |
| `'external'` | `ref`（1–128 字符）；可选 `display.name` / `display.avatarUrl` | 商户侧标签。不验证身份，快照写入支付单，供 Dashboard 对账。 |
| `'olares'` | `olaresId` 与 `did` 必须同时提供 | 走 DID 门并关闭 customer 账户，保留 VC 资格。 |

`ref` 是调用方自己的用户标识，不是 Olares 账号。`display` 仅作展示，网关只做格式校验。

```ts
await client.createPayment({ amountCents: 500 });

await client.createPayment({
  amountCents: 500,
  buyer: { kind: 'external', ref: 'user_8817', display: { name: 'Ada' } },
});

await client.createPayment({
  amountCents: 500,
  buyer: { kind: 'olares', olaresId: 'alice.olares.com', did: 'did:olares:0x…' },
});
```

### CreatePaymentResult

| 字段 | 说明 |
|---|---|
| `paymentId` | 支付单 ID，后续查询与对账使用。 |
| `checkoutUrl` | 托管收银台地址（含 `intent_id`、`client_secret` 及回跳参数）。 |

支付单有过期时间（默认约 30 分钟，以网关 `INTENT_TTL_SECS` 为准）。过期后同一 `checkoutUrl` 不可再付。

---

## getPayment

```ts
getPayment(paymentId: string): Promise<PaymentResult>
```

未支付不抛错。`paid: true` 当且仅当 `status === 'PAYMENT_STATUS_SUCCEEDED'` 且最近一次尝试带有 `txHash`。成功但缺少 `txHash` 时返回 `paid: false`，不得履约。

```ts
const result = await client.getPayment(paymentId);

if (result.paid) {
  const { txHash, payAmount, payCurrency, chain } = result.credential;
} else {
  // result.payment.status
}
```

---

## listPayments

```ts
listPayments(params?: ListPaymentsRequest): Promise<ListPaymentsResponse>
```

| 字段 | 说明 |
|---|---|
| `status` | 精确状态过滤。 |
| `metadata` | JSONB 包含匹配（`metadata @> filter`）。 |
| `cursor` | 上一页的 `nextCursor`。 |
| `limit` | 默认 20，上限 200。 |

列表条目不含 `clientSecret`。

```ts
const { items, hasMore, nextCursor } = await client.listPayments({
  status: 'PAYMENT_STATUS_SUCCEEDED',
  metadata: { order_id: 'ord_123' },
  limit: 20,
});
```

---

## Channels and wallets

```ts
const { channels } = await client.listChannels();

const { items, hasMore, nextCursor } = await client.listReceiveWalletTransactions({
  address: '0x…', // 须属于当前账户的收款钱包；省略则不按地址过滤
  limit: 50,
});
```

`listSupportedChains` 返回官方链与代币目录。`listPaymentMethodConfigs` / `upsertOnchainPmc` 用于配置各链收款地址与代币白名单（`tokens` 为空表示该链不收款）。

```ts
await client.upsertOnchainPmc({
  chains: [
    { chainId: '10', receiveWallet: '0x…', tokens: ['USDC'] },
  ],
});
```

---

## Account and connectivity

```ts
const account = await client.getAccount();
// { accountId, did, olaresId, status }

const info = await client.clientInfo();
// { keyType, accountId, did, olaresId }

const { serverTime } = await client.ping();
```

`ping` 为公开接口。当前实现仍走签名路径，构造 client 时需要密钥。

---

## verifyTransaction

日常履约使用 `getPayment` 与 Webhook。本方法用于独立核验链上 receipt。

```ts
const v = await client.verifyTransaction(txHash, 'optimism', 'mainnet');
if (v.confirmed) {
  // v.blockNumber, v.status === 'success'
}
```

未配置 `rpcUrl` 时请求 `POST /api/verifyTx`。已配置则直连该 RPC。仅支持 EVM。`chain` / `network` 仅网关透传路径需要。

---

## Webhooks

Dashboard 登记接收 URL 后获得 `whsec_`。验签规范：

- 请求头：`x-olares-payment-webhook-timestamp`、`x-olares-payment-webhook-signature`
- 签名原文：`{timestamp}\n{rawBody}`，HMAC-SHA256，十六进制
- 默认允许 5 分钟时钟偏差
- **body 必须是原始字节**（Express 使用 `express.raw`，不要先 `express.json`）

```ts
import { webhooks } from '@olares/payment-sdk';

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = webhooks.constructEvent(req, process.env.PAYMENT_WEBHOOK_SECRET!);
    switch (event.type) {
      case 'payment.succeeded':
        break;
      case 'payment.failed':
        break;
      case 'payment.canceled':
        break;
    }
    res.status(200).send('ok');
  } catch {
    res.status(400).send('bad signature');
  }
});
```

亦可传入 `{ body, headers }`。验签失败抛出 `PaymentError`，不得当作已投递。接收方须返回 2xx，否则网关重试。

---

## Errors

失败时抛出 `PaymentError`。

```ts
import { PaymentError, PAYMENT_NOT_FOUND } from '@olares/payment-sdk';

try {
  await client.getPayment(paymentId);
} catch (err) {
  if (err instanceof PaymentError) {
    err.code;
    err.httpStatus; // SDK 本地错误为 0
    err.message;
  }
}
```

| 范围 | 含义 |
|---|---|
| `1000–1699` | 请求已到达网关。按 `code` 处理。 |
| `1900–1999` | 请求未到达网关（超时、网络、直连 RPC）。可考虑重试。 |

| 码 | 常量 | 说明 |
|---|---|---|
| 1000 | `INTERNAL_ERROR` | 服务端内部错误 |
| 1100 | `INVALID_ARGUMENT` | 参数错误（含买家档位混用） |
| 1104 | `INVALID_RETURN_URL` | `returnUrl` 非法 |
| 1203 | `PAYMENT_NOT_FOUND` | 支付不存在 |
| 1300 | `PERMISSION_DENIED` | 权限不足 |
| 1500 | `SIGNATURE_MISMATCH` | HMAC 或 Webhook 签名不匹配 |
| 1501 | `INVALID_API_KEY` | 密钥无效 |
| 1502 | `TIMESTAMP_EXPIRED` | 时间戳超出窗口 |
| 1901 | `SDK_TIMEOUT` | 请求超时 |
| 1902 | `SDK_NETWORK_ERROR` | 网络或非 JSON 响应 |
| 1903 | `SDK_RPC_ERROR` | 直连 RPC 失败 |

---

## Payment

`getPayment` / `listPayments` 返回的支付对象（字段以类型定义为准）：

| 字段 | 说明 |
|---|---|
| `paymentId` | 支付单 ID |
| `merchantAccountId` | 收款账户 |
| `buyer` | 创建时的买家快照；匿名为 `null` |
| `amountCents` / `currency` | 计价 |
| `status` | `PAYMENT_STATUS_*` |
| `settlementCurrency` / `settlementAmount` | 链上结算币种与数量 |
| `metadata` | 创建时写入的透传字段 |
| `clientSecret` | 仅创建响应路径可能有值；列表项不回填 |
| `latestAttempt` | 最近一次尝试（含 `txHash` 等） |
| `expiresAt` / `canceledAt` / `paidAt` / `createdAt` / `updatedAt` | RFC3339 时间戳 |

`PaymentResult` 在 `paid: true` 时另带 `credential`（`txHash`、`payAmount`、`payCurrency`、`chain`、`chainType`、`networkId`），与 Webhook `payment.succeeded` 的凭证形状一致。
