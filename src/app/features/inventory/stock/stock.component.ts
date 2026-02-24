import { AsyncPipe, DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BehaviorSubject, combineLatest, map } from 'rxjs';

import { InventoryService } from '../../../core/services/inventory.service';
import { ProductService } from '../../../core/services/product.service';
import { AuthService } from '../../../core/services/auth.service';
import { StockOverview } from '../../../shared/models/stock.model';

@Component({
  selector: 'app-stock',
  imports: [AsyncPipe, DatePipe, NgClass, NgFor, NgIf, RouterLink],
  templateUrl: './stock.component.html',
  styleUrl: './stock.component.scss'
})
export class StockComponent {
  private readonly productService = inject(ProductService);
  private readonly inventoryService = inject(InventoryService);
  private readonly authService = inject(AuthService);
  private readonly searchTerm$ = new BehaviorSubject<string>('');
  private readonly statusFilter$ = new BehaviorSubject<StockFilterStatus>('all');
  private readonly categoryFilter$ = new BehaviorSubject<string>('all');

  get isSuperAdmin(): boolean {
    return this.authService.hasAnyRole('super_admin', 'admin');
  }

  readonly vm$ = combineLatest([
    this.productService.getProducts$(),
    this.inventoryService.getAllStock$(),
    this.searchTerm$,
    this.statusFilter$,
    this.categoryFilter$
  ]).pipe(
    map(([products, stock, searchTerm, statusFilter, categoryFilter]) => {
      const stockByProductId = new Map(stock.map((item) => [item.productId, item]));

      const rows = products
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

      const normalizedSearch = normalizeText(searchTerm);
      const filteredRows = rows.filter((row) => {
        const category = (row.category || 'Sin categoria').trim() || 'Sin categoria';
        const matchesCategory = categoryFilter === 'all' || category === categoryFilter;

        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'out' && row.quantity === 0) ||
          (statusFilter === 'low' && row.isLowStock && row.quantity > 0) ||
          (statusFilter === 'ok' && !row.isLowStock);

        const matchesSearch =
          !normalizedSearch ||
          normalizeText(row.productName).includes(normalizedSearch) ||
          normalizeText(row.sku || '').includes(normalizedSearch) ||
          normalizeText(category).includes(normalizedSearch);

        return matchesCategory && matchesStatus && matchesSearch;
      });

      const totalUnits = rows.reduce((sum, row) => sum + row.quantity, 0);
      const lowStockCount = rows.filter((row) => row.isLowStock).length;
      const outOfStockCount = rows.filter((row) => row.quantity === 0).length;
      const healthyCount = rows.filter((row) => !row.isLowStock).length;
      const categories = new Set(
        rows.map((row) => (row.category || 'Sin categoria').trim() || 'Sin categoria')
      ).size;
      const categoryOptions = [...new Set(rows.map((row) => (row.category || 'Sin categoria').trim() || 'Sin categoria'))]
        .sort((a, b) => a.localeCompare(b));

      const filteredUnits = filteredRows.reduce((sum, row) => sum + row.quantity, 0);

      const topStockChart = toBars(
        [...filteredRows]
          .sort((a, b) => b.quantity - a.quantity || a.productName.localeCompare(b.productName))
          .slice(0, 8)
          .map((row) => ({
            label: row.productName,
            hint: `SKU: ${row.sku || 'N/A'}`,
            value: row.quantity,
            tone: row.isLowStock ? 'warn' : 'ok'
          }))
      );

      const lowStockChart = toBars(
        filteredRows
          .filter((row) => row.isLowStock)
          .sort(
            (a, b) =>
              b.minStock - b.quantity - (a.minStock - a.quantity) ||
              a.productName.localeCompare(b.productName)
          )
          .slice(0, 8)
          .map((row) => ({
            label: row.productName,
            hint: `Actual ${row.quantity} / Min ${row.minStock}`,
            value: Math.max(row.minStock - row.quantity, 0),
            tone: 'warn' as const
          }))
      );

      const categoryMap = new Map<string, { quantity: number; products: number }>();
      for (const row of filteredRows) {
        const category = (row.category || 'Sin categoria').trim() || 'Sin categoria';
        const current = categoryMap.get(category) ?? { quantity: 0, products: 0 };
        current.quantity += row.quantity;
        current.products += 1;
        categoryMap.set(category, current);
      }

      const categoryChart = toBars(
        [...categoryMap.entries()]
          .sort((a, b) => b[1].quantity - a[1].quantity || a[0].localeCompare(b[0]))
          .slice(0, 6)
          .map(([label, stats]) => ({
            label,
            hint: `${stats.products} producto(s)`,
            value: stats.quantity,
            tone: 'neutral' as const
          }))
      );

      const priorityRestock = [...rows]
        .filter((row) => row.isLowStock)
        .map((row) => ({
          ...row,
          deficit: Math.max(row.minStock - row.quantity, 0),
          suggestedReorder: Math.max(row.minStock * 2 - row.quantity, 0)
        }))
        .sort((a, b) => b.deficit - a.deficit || a.productName.localeCompare(b.productName))
        .slice(0, 6);

      const recentMovementCount = rows.filter((row) => {
        if (!row.updatedAt) return false;
        const updatedTime = new Date(row.updatedAt).getTime();
        return Number.isFinite(updatedTime) && Date.now() - updatedTime <= 7 * 24 * 60 * 60 * 1000;
      }).length;

      const categoryHealth = categoryOptions
        .map((category) => {
          const categoryRows = rows.filter(
            (row) => ((row.category || 'Sin categoria').trim() || 'Sin categoria') === category
          );
          const low = categoryRows.filter((row) => row.isLowStock).length;
          return {
            category,
            products: categoryRows.length,
            low,
            units: categoryRows.reduce((sum, row) => sum + row.quantity, 0),
            status: low === 0 ? 'ok' : low === categoryRows.length ? 'warn' : 'neutral'
          };
        })
        .sort((a, b) => b.low - a.low || b.units - a.units || a.category.localeCompare(b.category))
        .slice(0, 8);

      return {
        rows: filteredRows,
        allRowsCount: rows.length,
        filters: {
          searchTerm,
          statusFilter,
          categoryFilter,
          categoryOptions
        },
        summary: {
          totalProducts: rows.length,
          totalUnits,
          lowStockCount,
          categories,
          outOfStockCount,
          healthyCount
        },
        filteredSummary: {
          visibleProducts: filteredRows.length,
          visibleUnits: filteredUnits
        },
        charts: {
          topStock: topStockChart,
          lowStock: lowStockChart,
          categories: categoryChart
        },
        admin: {
          alerts: {
            critical: outOfStockCount,
            low: Math.max(lowStockCount - outOfStockCount, 0),
            healthy: healthyCount,
            noRecentMovement: Math.max(rows.length - recentMovementCount, 0)
          },
          priorityRestock,
          categoryHealth,
          quickActions: [
            {
              title: 'Alta de producto',
              description: 'Registrar producto nuevo con SKU, categoria y stock minimo.',
              route: '/products/new'
            },
            {
              title: 'Movimientos masivos',
              description: 'Cargar entradas/salidas para ajuste de inventario.',
              route: '/stock/movements'
            },
            {
              title: 'Usuarios y roles',
              description: 'Asignar permisos de almacen, ventas y administracion.',
              route: '/admin/users'
            }
          ]
        }
      };
    })
  );

  updateSearchTerm(term: string): void {
    this.searchTerm$.next(term);
  }

  updateStatusFilter(status: string): void {
    this.statusFilter$.next(isStockFilterStatus(status) ? status : 'all');
  }

  updateCategoryFilter(category: string): void {
    this.categoryFilter$.next(category || 'all');
  }

  clearFilters(): void {
    this.searchTerm$.next('');
    this.statusFilter$.next('all');
    this.categoryFilter$.next('all');
  }
}

type ChartTone = 'ok' | 'warn' | 'neutral';
type StockFilterStatus = 'all' | 'ok' | 'low' | 'out';

interface ChartInput {
  label: string;
  hint: string;
  value: number;
  tone: ChartTone;
}

interface ChartBar extends ChartInput {
  widthPercent: number;
}

function toBars(items: ChartInput[]): ChartBar[] {
  const maxValue = Math.max(1, ...items.map((item) => item.value));
 
  return items.map((item) => ({
    ...item,
    widthPercent: Math.max(4, Math.round((item.value / maxValue) * 100))
  }));
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isStockFilterStatus(value: string): value is StockFilterStatus {
  return value === 'all' || value === 'ok' || value === 'low' || value === 'out';
}
