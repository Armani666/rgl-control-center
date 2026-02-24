import { Injectable, inject } from '@angular/core';
import { combineLatest, map } from 'rxjs';

import { PurchaseSuggestion } from '../../shared/models/purchase-suggestion.model';
import { InventoryService } from './inventory.service';
import { ProductService } from './product.service';
import { SupplierService } from './supplier.service';

@Injectable({ providedIn: 'root' })
export class ProcurementService {
  private readonly productService = inject(ProductService);
  private readonly inventoryService = inject(InventoryService);
  private readonly supplierService = inject(SupplierService);

  readonly suggestions$ = combineLatest([
    this.productService.getProducts$(),
    this.inventoryService.getAllStock$(),
    this.inventoryService.getAllMovements$(),
    this.supplierService.getSuppliers$(),
    this.supplierService.getProductSupplierLinks$()
  ]).pipe(
    map(([products, stockRecords, movements, suppliers, productSupplierLinks]) => {
      const stockByProductId = new Map(stockRecords.map((item) => [item.productId, item]));
      const suppliersById = new Map(suppliers.map((item) => [item.id, item]));
      const preferredLinkByProductId = new Map<string, (typeof productSupplierLinks)[number]>();
      for (const link of [...productSupplierLinks].sort((a, b) => Number(b.preferred) - Number(a.preferred))) {
        if (!preferredLinkByProductId.has(link.productId)) {
          preferredLinkByProductId.set(link.productId, link);
        }
      }

      const now = Date.now();
      const last30Days = 30 * 24 * 60 * 60 * 1000;

      return products
        .filter((product) => product.active)
        .map<PurchaseSuggestion>((product) => {
          const stock = stockByProductId.get(product.id);
          const currentStock = stock?.quantity ?? 0;
          const minStock = stock?.minStock ?? product.minStock ?? 0;
          const relevantOutMovements = movements.filter(
            (movement) =>
              movement.productId === product.id &&
              movement.type === 'OUT' &&
              movement.createdAt &&
              now - movement.createdAt.getTime() <= last30Days
          );
          const outgoingUnits30d = relevantOutMovements.reduce((sum, item) => sum + item.quantity, 0);
          const averageDailyOut = outgoingUnits30d / 30;

          const preferredLink = preferredLinkByProductId.get(product.id);
          const fallbackSupplierId = product.supplierId ?? null;
          const supplierId = preferredLink?.supplierId || fallbackSupplierId || null;
          const supplier =
            (supplierId ? suppliersById.get(supplierId) : null) ??
            (fallbackSupplierId ? suppliersById.get(fallbackSupplierId) : null) ??
            null;

          const leadTimeDays = Math.max(
            1,
            preferredLink?.preferred
              ? supplier?.leadTimeDays || product.leadTimeDays || 7
              : product.leadTimeDays || supplier?.leadTimeDays || 7
          );
          const safetyStock = Math.max(minStock, Math.ceil(averageDailyOut * 7));
          const reorderPoint = Math.max(minStock, Math.ceil(averageDailyOut * leadTimeDays) + safetyStock);
          const targetStock = reorderPoint + Math.max(minStock, Math.ceil(averageDailyOut * 14));
          let recommendedQty = Math.max(targetStock - currentStock, 0);

          if (preferredLink?.minOrderQty) {
            recommendedQty = roundUpToMinimum(recommendedQty, preferredLink.minOrderQty);
          }

          const unitCost =
            preferredLink?.cost && preferredLink.cost > 0
              ? preferredLink.cost
              : product.cost && product.cost > 0
                ? product.cost
                : null;

          const daysOfCoverage =
            averageDailyOut > 0 ? Number((currentStock / averageDailyOut).toFixed(1)) : null;

          return {
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            category: product.category,
            currentStock,
            minStock,
            recommendedQty,
            reorderPoint,
            safetyStock,
            averageDailyOut: Number(averageDailyOut.toFixed(2)),
            daysOfCoverage,
            supplierId: supplier?.id ?? null,
            supplierName: supplier?.name ?? null,
            leadTimeDays,
            estimatedUnitCost: unitCost,
            estimatedTotalCost: unitCost == null ? null : Number((unitCost * recommendedQty).toFixed(2)),
            priority: classifyPriority(currentStock, minStock, reorderPoint)
          };
        })
        .filter((item) => item.recommendedQty > 0 || item.priority === 'critical')
        .sort(compareSuggestions);
    })
  );
}

function classifyPriority(
  currentStock: number,
  minStock: number,
  reorderPoint: number
): PurchaseSuggestion['priority'] {
  if (currentStock <= 0) return 'critical';
  if (currentStock <= minStock) return 'high';
  if (currentStock <= reorderPoint) return 'medium';
  return 'low';
}

function compareSuggestions(a: PurchaseSuggestion, b: PurchaseSuggestion): number {
  const weight = (value: PurchaseSuggestion['priority']): number =>
    value === 'critical' ? 4 : value === 'high' ? 3 : value === 'medium' ? 2 : 1;
  return (
    weight(b.priority) - weight(a.priority) ||
    b.recommendedQty - a.recommendedQty ||
    a.productName.localeCompare(b.productName)
  );
}

function roundUpToMinimum(quantity: number, minOrderQty: number): number {
  if (quantity <= 0) {
    return 0;
  }

  const normalizedMin = Math.max(1, Math.floor(minOrderQty));
  return Math.ceil(quantity / normalizedMin) * normalizedMin;
}
