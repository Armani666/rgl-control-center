import { AsyncPipe, CurrencyPipe, NgClass, NgFor, NgIf } from '@angular/common';
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
  imports: [AsyncPipe, CurrencyPipe, NgClass, NgFor, NgIf, RouterLink],
  templateUrl: './product-list.component.html',
  styleUrl: './product-list.component.scss'
})
export class ProductListComponent {
  private readonly productService = inject(ProductService);
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly deletingIds = new Set<string>();

  deletionError: string | null = null;

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

  isDeleting(productId: string): boolean {
    return this.deletingIds.has(productId);
  }

  async deleteProduct(row: ProductListRow): Promise<void> {
    if (!this.canEditProducts || this.deletingIds.has(row.productId)) {
      return;
    }

    const productLabel = row.sku || row.productName;
    const confirmed = window.confirm(
      `Esto eliminara el producto ${productLabel} y su historial relacionado. Esta accion no se puede deshacer. Deseas continuar?`
    );

    if (!confirmed) {
      return;
    }

    this.deletionError = null;
    this.deletingIds.add(row.productId);

    try {
      await this.productService.deleteProduct(row.productId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar el producto.';
      this.deletionError = message;
    } finally {
      this.deletingIds.delete(row.productId);
    }
  }
}
