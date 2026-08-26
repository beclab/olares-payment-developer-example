export interface Product {
  id: string;
  title: string;
  blurb: string;
  priceCents: number;
}

export const PRODUCTS: Product[] = [
  { id: 'mug', title: 'Harbor Mug', blurb: 'Stoneware cup. Holds a long pour.', priceCents: 1800 },
  { id: 'notebook', title: 'Field Notebook', blurb: 'Dot-grid, 80 pages, pocket size.', priceCents: 1200 },
  { id: 'sticker', title: 'Lighthouse Sticker', blurb: 'Vinyl, weatherproof, 8cm.', priceCents: 400 },
];

export function findProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
