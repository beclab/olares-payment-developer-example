# Refund 开放问题追踪 — 从 demo 实现反推

> 这份文档有两个作用：(1) 记录设计稿 §6 各开放问题在实现中采用的**默认决策**（已落地，可直接体验）；
> (2) 沉淀 demo 作为集成方**反推 SDK / 网关的改进项**——用真实集成暴露接口缺口，是本 demo 的目的之一。
> 体验路径：`npm start` → 买家下单支付 → `/admin` 登录（admin/admin）→ 订单行点开抽屉 → Refund…

## 1. 已按默认落地的决策

| # | 问题 | 采用的默认 | 落点 |
|---|---|---|---|
| Q1 | `refunded` 终态徽章配色 | **indigo soft**（`b-indigo`），与 failed 的 red 明确区分 | `index.html` / `admin.html` 的 `REFUND_BADGE` |
| Q2 | 买家是否看到"退款处理中" | **展示** `Refund in progress` 徽章，但不带商户内部 reason / stale 提示 | 买家订单行 + 订单详情 |
| Q3 | 操作员签名钱包 | 不在 example 造钱包 UI，直接外跳网关**退款执行页**（simulated 流程）；执行页已拦截合约钱包 | admin 一次性链接弹窗 "Open execution page" |
| Q4 | executionUrl 过期后的引导 | 弹窗内检测过期即出现 **Reissue link** 按钮，一键重签 | `admin.html` `showLink()` |
| Q5 | 买家收据页 URL 来源 | 服务端用 `clientSecret` **自拼** `${DEFAULT_BASE_URL}/receipt?…` | `server.js` `receiptUrlOf()` |

## 2. Demo 反推的 SDK / 网关改进项（对外反馈清单）

### R1. `getPayment` 应直接返回 `receiptUrl`（源自 Q5）★ 主要项

- **现状**：dashboard 详情走后端字段 `receipt_url`（refund v3 step 9，`PaymentIntentView.receipt_url`），但 SDK `Payment` 类型没有该字段，merchant 侧拿不到。
- **demo 里的 workaround**：`receiptUrlOf()` 用 `payment.clientSecret` + SDK 导出的 `DEFAULT_BASE_URL` 自拼——脆弱：收据页路径是网关实现细节，`baseUrl` 一旦被自定义（`ClientOptions.baseUrl`），拼接就错。
- **建议**：`Payment` 增加 `receiptUrl: string | null`（与 dashboard 同源），或 SDK 导出一个官方 builder。demo 侧改一行即可切换。

### R2. webhook `RefundCallback` 建议回显 metadata

- **现状**：`refund.succeeded|failed` 只带 `refund_id` / `intent_id`，不带下单时的 `metadata`；payment.* 事件带。
- **代价**：商户必须自维护 `refundId → 业务单` 映射（demo 里是内存 Map；真实商户要建表），且 dashboard/别处开的退款首单 webhook 只能靠 `intent_id` 二级反查。
- **建议**：RefundCallback 回显原 payment metadata，与 payment.* 对齐，商户 webhook 路由就能统一。

### R3. SDK 缺"退款列表"便捷接口（可讨论）

- **现状**：只有 `getRefund(单笔)`；订单维度的账本要靠 `getPayment().refundSummary`（且仅 succeeded 单、refunds 条目是买家裁剪版，无 reason/stale/stuck）。
- **代价**：商户侧做"全部退款中的单"运营视图时，得自己 list payments + 逐单 getPayment。
- **建议**：`listRefunds({status?, cursor?})`，或至少让 merchant 视角的 `refundSummary.refunds` 携带全字段（现在是买家受众裁剪）。

### R4. `reissueRefundLink` 的语义文档化

- **现状**：重签会轮换 secret、旧链接立即失效——SDK JSDoc 有写，但**没有错误码**提示"旧链接已失效 vs 从未存在"，执行页侧也难区分。
- **demo 里的感受**：admin 弹窗只能笼统提示 expired；如果 SDK/网关能返回"旧链接最后被使用的时刻"或明确的过期错误码，引导可以更准。
- **建议**：`GetRefundExecution` 对过期链接返回结构化错误码，SDK 透传。

### R5. 小项：`Refund.amount` 的展示辅助

- **现状**：`RefundRoute.tokenDecimals` 可能为 null（未注册 token），此时前端无法格式化最小单位金额。
- **demo 里的 workaround**：`fmtMinor` 退化为直接显示原始 string。
- **建议**：网关对未注册 token 也回填 decimals（链上可查），或 SDK 提供 graceful formatter。

## 3. 体验检查单（对照感受区别）

1. 买家页 `/`：Ledger 新皮肤；订单行 Refund 列；详情页 Refunds 区块 + 收据页外链。
2. admin `/admin`：KPI 行多 Refunded orders；订单行点开**抽屉**；Refund ledger（received/refunded/remaining/route）。
3. 发起退款：金额留空 = 全额剩余；创建后**一次性链接弹窗**（复制/打开/过期时间）。
4. 执行页签名（simulated）后：webhook `refund.succeeded` 推动订单 → `Refunded`（indigo 徽章），买家侧同步。
5. 失败/取消路径：Cancel refund 释放额度 → 可重新开退款；链接过期 → Reissue。
