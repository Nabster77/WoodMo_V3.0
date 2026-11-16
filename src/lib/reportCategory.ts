import type { Category, Product, Transaction } from '@/types';

/**
 * Berichte gruppieren nach der Warengruppe, die im Bon steht. Wurden Warengruppen
 * zusammengelegt (z. B. „Kurze (Likör)“ → „Kurze“), gibt es die alte Gruppe nicht mehr;
 * ihre Bons würden als „Unbekannt“ erscheinen. Nur für die Anzeige: Unbekannte Gruppe →
 * aktuelle Gruppe desselben Artikels (gleiche Artikel-ID). Gespeicherte Bons bleiben unverändert.
 */
export function withCurrentCategories(transactions: Transaction[], categories: Category[], products: Product[]): Transaction[] {
  const known = new Set(categories.map((c) => c.id));
  const productCategory = new Map(products.filter((p) => known.has(p.categoryId)).map((p) => [p.id, p.categoryId]));
  let changed = false;
  const result = transactions.map((tx) => {
    if (tx.items.every((item) => known.has(item.categoryId) || !productCategory.has(item.productId))) return tx;
    changed = true;
    return {
      ...tx,
      items: tx.items.map((item) => known.has(item.categoryId) || !productCategory.has(item.productId)
        ? item
        : { ...item, categoryId: productCategory.get(item.productId)! }),
    };
  });
  return changed ? result : transactions;
}
