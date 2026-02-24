import { AsyncPipe, DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';

import { InventoryService } from '../../../core/services/inventory.service';
import { ProductService } from '../../../core/services/product.service';

@Component({
  selector: 'app-movement-audit',
  imports: [AsyncPipe, DatePipe, NgClass, NgFor, NgIf],
  templateUrl: './movement-audit.component.html',
  styleUrl: './movement-audit.component.scss'
})
export class MovementAuditComponent {
  private readonly inventoryService = inject(InventoryService);
  private readonly productService = inject(ProductService);
  private readonly search$ = new BehaviorSubject<string>('');
  private readonly type$ = new BehaviorSubject<'all' | 'IN' | 'OUT'>('all');

  readonly vm$ = combineLatest([
    this.inventoryService.getAllMovements$(),
    this.productService.getProducts$(),
    this.search$,
    this.type$
  ]).pipe(
    map(([movements, products, search, type]) => {
      const productById = new Map(products.map((product) => [product.id, product]));
      const normalizedSearch = normalize(search);

      const rows = movements
        .map((movement) => {
          const product = productById.get(movement.productId);
          return {
            ...movement,
            productName: product?.name ?? 'Producto eliminado',
            sku: product?.sku ?? '-',
            category: product?.category ?? 'Sin categoria'
          };
        })
        .filter((row) => {
          const matchesType = type === 'all' || row.type === type;
          const matchesSearch =
            !normalizedSearch ||
            normalize(row.productName).includes(normalizedSearch) ||
            normalize(row.sku).includes(normalizedSearch) ||
            normalize(row.reason).includes(normalizedSearch) ||
            normalize(row.createdByEmail || '').includes(normalizedSearch);
          return matchesType && matchesSearch;
        });

      return {
        rows,
        totals: {
          total: rows.length,
          incoming: rows.filter((item) => item.type === 'IN').reduce((sum, item) => sum + item.quantity, 0),
          outgoing: rows.filter((item) => item.type === 'OUT').reduce((sum, item) => sum + item.quantity, 0)
        },
        filters: { search, type }
      };
    })
  );

  updateSearch(value: string): void {
    this.search$.next(value);
  }

  updateType(value: string): void {
    this.type$.next(value === 'IN' || value === 'OUT' ? value : 'all');
  }
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
