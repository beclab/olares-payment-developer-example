/** Gateway `pay_amount` is token minimal units (USDC/USDT = 6). */
const TOKEN_DECIMALS = { USDC: 6, USDT: 6, ETH: 18, POL: 18, BNB: 18, AVAX: 18 };

export function formatToken(minimal, symbol) {
  if (minimal == null || minimal === '') return '';
  const dec = TOKEN_DECIMALS[String(symbol || '').toUpperCase()] ?? 6;
  try {
    const n = BigInt(String(minimal));
    const base = 10n ** BigInt(dec);
    const whole = n / base;
    const frac = (n % base).toString().padStart(dec, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  } catch {
    return String(minimal);
  }
}

/** BuyerRef snapshot: omitted = anonymous; olares / external otherwise. */
export function formatBuyer(buyer) {
  if (buyer == null) return 'anonymous';
  if (buyer.kind === 'olares') return `olares ${buyer.olaresId}`;
  const name = buyer.display?.name;
  return name ? `external ${buyer.ref} (${name})` : `external ${buyer.ref}`;
}
