import { AsyncPipe, DatePipe, NgClass, NgFor } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { combineLatest, map } from 'rxjs';

import { InventoryService } from '../../../core/services/inventory.service';
import { ProductService } from '../../../core/services/product.service';
import { StockOverview } from '../../../shared/models/stock.model';

@Component({
  selector: 'app-stock',
  imports: [AsyncPipe, DatePipe, NgClass, NgFor, RouterLink],
  templateUrl: './stock.component.html',
  styleUrl: './stock.component.scss'
})
export class StockComponent {
  private readonly productService = inject(ProductService);
  private readonly inventoryService = inject(InventoryService);

  readonly stockRows$ = combineLatest([
    this.productService.getProducts$(),
    this.inventoryService.getAllStock$()
  ]).pipe(
    map(([products, stock]) => {
      const stockByProductId = new Map(stock.map((item) => [item.productId, item]));

      return products
        .map<StockOverview>((product) => {
          const currentStock = stockByProductId.get(product.id);
          const quantity = currentStock?.quantity ?? 0;
          const minStock = currentStock?.minStock ?? product.minStock;

          return {
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            category: product.category,
            quantity,
            minStock,
            updatedAt: currentStock?.updatedAt ?? null,
            isLowStock: quantity <= minStock
          };
        })
        .sort((a, b) => Number(b.isLowStock) - Number(a.isLowStock) || a.productName.localeCompare(b.productName));
    })
  );
}
