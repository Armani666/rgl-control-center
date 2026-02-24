import { AsyncPipe, DatePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BehaviorSubject, combineLatest, map } from 'rxjs';
import {
  ApexAxisChartSeries,
  ApexChart,
  ApexDataLabels,
  ApexFill,
  ApexGrid,
  ApexLegend,
  ApexNonAxisChartSeries,
  ApexPlotOptions,
  ApexResponsive,
  ApexStroke,
  ApexTooltip,
  ApexXAxis,
  ChartComponent
} from 'ng-apexcharts';

import { InventoryService } from '../../../core/services/inventory.service';
import { ProductService } from '../../../core/services/product.service';
import { AuthService } from '../../../core/services/auth.service';
import { StockOverview } from '../../../shared/models/stock.model';

@Component({
  selector: 'app-stock',
  imports: [AsyncPipe, DatePipe, NgClass, NgFor, NgIf, RouterLink, ChartComponent],
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
    return this.authService.hasRole('super_admin');
  }

  get canRegisterMovement(): boolean {
    return this.authService.canManageInventory();
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
        apex: {
          topStock: buildHorizontalBarChart(topStockChart, {
            valueLabel: 'Unidades',
            colors: topStockChart.map((item) =>
              item.tone === 'warn' ? '#F57F39' : '#6D3BFF'
            )
          }),
          lowStock: buildHorizontalBarChart(lowStockChart, {
            valueLabel: 'Deficit',
            colors: lowStockChart.map((item) =>
              item.value >= 8 ? '#EF476F' : item.value >= 4 ? '#F57F39' : '#A46CFF'
            )
          }),
          categories: buildDonutChart(categoryChart)
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

interface HorizontalBarChartConfig {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  plotOptions: ApexPlotOptions;
  dataLabels: ApexDataLabels;
  xaxis: ApexXAxis;
  grid: ApexGrid;
  tooltip: ApexTooltip;
  stroke: ApexStroke;
  colors: string[];
  legend: ApexLegend;
}

interface DonutChartConfig {
  series: ApexNonAxisChartSeries;
  chart: ApexChart;
  labels: string[];
  legend: ApexLegend;
  dataLabels: ApexDataLabels;
  tooltip: ApexTooltip;
  stroke: ApexStroke;
  fill: ApexFill;
  colors: string[];
  responsive: ApexResponsive[];
}

function toBars(items: ChartInput[]): ChartBar[] {
  const maxValue = Math.max(1, ...items.map((item) => item.value));

  return items.map((item) => ({
    ...item,
    widthPercent:
      item.value <= 0 ? 0 : Math.max(8, Math.round((item.value / maxValue) * 100))
  }));
}

function buildHorizontalBarChart(
  items: ChartBar[],
  options: { colors: string[]; valueLabel: string }
): HorizontalBarChartConfig {
  const labels = items.map((item) => item.label);
  const values = items.map((item) => item.value);

  return {
    series: [{ name: options.valueLabel, data: values }],
    chart: {
      type: 'bar',
      height: Math.max(240, items.length * 52),
      toolbar: { show: false },
      sparkline: { enabled: false },
      fontFamily: 'inherit',
      animations: { enabled: true }
    },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 8,
        borderRadiusApplication: 'end',
        barHeight: '48%',
        distributed: true
      }
    },
    dataLabels: {
      enabled: true,
      style: {
        fontSize: '12px',
        fontWeight: 700,
        colors: ['#2c1f3b']
      },
      formatter: (value: number) => `${Math.round(value)}`
    },
    xaxis: {
      categories: labels,
      labels: {
        style: {
          colors: Array(labels.length).fill('#7b6f8b'),
          fontSize: '11px'
        }
      },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    grid: {
      borderColor: '#eee4fa',
      strokeDashArray: 4,
      padding: { left: 8, right: 8, top: 0, bottom: 0 },
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } }
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: (value: number) => `${value} ${options.valueLabel.toLowerCase()}`
      }
    },
    stroke: {
      show: true,
      width: 1,
      colors: ['rgba(255,255,255,0.65)']
    },
    colors: options.colors.length ? options.colors : ['#7D50F5'],
    legend: { show: false }
  };
}

function buildDonutChart(items: ChartBar[]): DonutChartConfig {
  const labels = items.map((item) => item.label);
  const series = items.map((item) => item.value) as ApexNonAxisChartSeries;
  const palette = ['#7D50F5', '#A46CFF', '#5FD7B6', '#F8A25E', '#EF7091', '#6EC1FF'];

  return {
    series,
    chart: {
      type: 'donut',
      height: 300,
      toolbar: { show: false },
      fontFamily: 'inherit'
    },
    labels,
    legend: {
      position: 'bottom',
      fontSize: '12px',
      labels: { colors: '#6f6482' as any },
      itemMargin: { horizontal: 10, vertical: 4 }
    },
    dataLabels: {
      enabled: true,
      formatter: (_value: number, opts?: { seriesIndex?: number }) => {
        const index = opts?.seriesIndex ?? 0;
        return `${series[index] ?? 0}`;
      },
      style: {
        fontSize: '12px',
        fontWeight: 700,
        colors: ['#ffffff']
      }
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: (value: number) => `${value} unidades`
      }
    },
    stroke: {
      width: 3,
      colors: ['#ffffff']
    },
    fill: {
      type: 'gradient',
      gradient: {
        shade: 'light',
        type: 'vertical',
        shadeIntensity: 0.15,
        opacityFrom: 1,
        opacityTo: 0.85,
        stops: [0, 100]
      }
    },
    colors: labels.map((_, index) => palette[index % palette.length]),
    responsive: [
      {
        breakpoint: 640,
        options: {
          chart: { height: 260 },
          legend: { position: 'bottom' }
        }
      }
    ]
  };
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
