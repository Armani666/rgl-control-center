import { AsyncPipe, CurrencyPipe, NgClass, NgFor } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { combineLatest, map } from 'rxjs';

import { InventoryService } from '../../../core/services/inventory.service';
import { ProductService } from '../../../core/services/product.service';
import { AuthService } from '../../../core/services/auth.service';
import { StockOverview } from '../../../shared/models/stock.model';

interface ProductListRow extends StockOverview {
  price: number;
}

@Component({
  selector: 'app-product-list',
  imports: [AsyncPipe, CurrencyPipe, NgClass, NgFor, RouterLink],
  templateUrl: './product-list.component.html',
  styleUrl: './product-list.component.scss'
})
export class ProductListComponent {
  private readonly productService = inject(ProductService);
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);

  readonly rows$ = combineLatest([
    this.productService.getProducts$(),
    this.inventoryService.getAllStock$()
  ]).pipe(
    map(([products, stock]) => {
      const stockByProductId = new Map(stock.map((item) => [item.productId, item]));
      return products.map<ProductListRow>((product) => {
        const stockRecord = stockByProductId.get(product.id);
        const quantity = stockRecord?.quantity ?? 0;
        const minStock = stockRecord?.minStock ?? product.minStock ?? 0;
        return {
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          category: product.category,
          price: product.price,
          quantity,
          minStock,
          updatedAt: stockRecord?.updatedAt ?? null,
          isLowStock: quantity <= minStock
        };
      });
    })
  );

  get canCreateProducts(): boolean {
    return this.authService.canManageProducts();
  }

  get canEditProducts(): boolean {
    return this.authService.canManageProducts();
  }

  get canMoveStock(): boolean {
    return this.authService.canManageInventory();
  }
}
