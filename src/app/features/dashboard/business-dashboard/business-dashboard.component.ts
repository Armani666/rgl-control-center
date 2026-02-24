import { AsyncPipe, CurrencyPipe, DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
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
  ApexYAxis,
  ChartComponent
} from 'ng-apexcharts';

import { InventoryService } from '../../../core/services/inventory.service';
import { ProductService } from '../../../core/services/product.service';
import { SalesCommissionService } from '../../../core/services/sales-commission.service';
import { CommissionPayment, SalesRecord } from '../../../shared/models/sales-commission.model';

type DashboardPeriod = 'weekly' | 'monthly' | 'yearly';

interface PeriodConfig {
  key: DashboardPeriod;
  label: string;
  subtitle: string;
}

interface TrendChartConfig {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis | ApexYAxis[];
  grid: ApexGrid;
  stroke: ApexStroke;
  fill: ApexFill;
  tooltip: ApexTooltip;
  dataLabels: ApexDataLabels;
  colors: string[];
  legend: ApexLegend;
}

interface BarChartConfig {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  grid: ApexGrid;
  stroke: ApexStroke;
  tooltip: ApexTooltip;
  dataLabels: ApexDataLabels;
  plotOptions: ApexPlotOptions;
  colors: string[];
  legend: ApexLegend;
}

interface DonutConfig {
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

@Component({
  selector: 'app-business-dashboard',
  imports: [
    AsyncPipe,
    CurrencyPipe,
    DecimalPipe,
    NgClass,
    NgFor,
    NgIf,
    ChartComponent
  ],
  templateUrl: './business-dashboard.component.html',
  styleUrl: './business-dashboard.component.scss'
})
export class BusinessDashboardComponent {
  private readonly salesCommissionService = inject(SalesCommissionService);
  private readonly inventoryService = inject(InventoryService);
  private readonly productService = inject(ProductService);
  private readonly period$ = new BehaviorSubject<DashboardPeriod>('weekly');

  readonly periods: PeriodConfig[] = [
    { key: 'weekly', label: 'Semanal', subtitle: 'Ultimos 7 dias' },
    { key: 'monthly', label: 'Mensual', subtitle: 'Mes actual' },
    { key: 'yearly', label: 'Anual', subtitle: 'Año actual' }
  ];

  readonly vm$ = combineLatest([
    this.salesCommissionService.getSalesRecords$(),
    this.salesCommissionService.getCommissionPayments$(),
    this.inventoryService.getAllStock$(),
    this.productService.getProducts$(),
    this.period$
  ]).pipe(
    map(([sales, payments, stock, products, period]) => {
      const { currentStart, currentEnd, previousStart, previousEnd, bucketLabels } = getPeriodRange(period);

      const currentSales = sales.filter((item) => isInRange(item.saleDate, currentStart, currentEnd));
      const previousSales = sales.filter((item) => isInRange(item.saleDate, previousStart, previousEnd));
      const currentPayments = payments.filter((item) => isInRange(item.paymentDate, currentStart, currentEnd));

      const currentSalesAmount = sumBy(currentSales, (item) => item.totalAmount);
      const previousSalesAmount = sumBy(previousSales, (item) => item.totalAmount);
      const salesDeltaPct = calcDeltaPct(previousSalesAmount, currentSalesAmount);
      const currentCommission = sumBy(currentSales, (item) => item.commissionAmount);
      const currentCommissionPaid = sumBy(currentPayments, (item) => item.amount);
      const currentUnitsSold = sumBy(currentSales, (item) => item.quantity);
      const orderCount = currentSales.length;
      const averageTicket = orderCount > 0 ? currentSalesAmount / orderCount : 0;

      const lowStockCount = stock.filter((item) => item.quantity <= item.minStock).length;
      const outOfStockCount = stock.filter((item) => item.quantity === 0).length;
      const activeProducts = products.filter((item) => item.active).length;

      const trendBuckets = bucketLabels.map((label) => ({
        label,
        sales: 0,
        commissions: 0
      }));
      const bucketIndexMap = new Map(bucketLabels.map((label, index) => [label, index]));

      for (const sale of currentSales) {
        const label = getBucketLabelForDate(sale.saleDate, period);
        if (!label) continue;
        const index = bucketIndexMap.get(label);
        if (index == null) continue;
        trendBuckets[index].sales += sale.totalAmount;
        trendBuckets[index].commissions += sale.commissionAmount;
      }

      const productMap = new Map<string, { product: string; units: number; sales: number }>();
      for (const sale of currentSales) {
        const key = (sale.productName || 'Venta manual').trim() || 'Venta manual';
        const current = productMap.get(key) ?? { product: key, units: 0, sales: 0 };
        current.units += sale.quantity;
        current.sales += sale.totalAmount;
        productMap.set(key, current);
      }
      const topProducts = [...productMap.values()]
        .sort((a, b) => b.sales - a.sales || b.units - a.units || a.product.localeCompare(b.product))
        .slice(0, 6);

      const sellerMap = new Map<string, { seller: string; sales: number; commissions: number; tickets: number }>();
      for (const sale of currentSales) {
        const seller = (sale.sellerName || sale.sellerEmail || 'Vendedor').trim();
        const current = sellerMap.get(seller) ?? { seller, sales: 0, commissions: 0, tickets: 0 };
        current.sales += sale.totalAmount;
        current.commissions += sale.commissionAmount;
        current.tickets += 1;
        sellerMap.set(seller, current);
      }
      const sellers = [...sellerMap.values()]
        .sort((a, b) => b.sales - a.sales || a.seller.localeCompare(b.seller))
        .slice(0, 6);

      const categorySalesMap = new Map<string, number>();
      const productById = new Map(products.map((item) => [item.id, item]));
      for (const sale of currentSales) {
        const product = sale.productId ? productById.get(sale.productId) : null;
        const category = (product?.category || 'Sin categoria').trim() || 'Sin categoria';
        categorySalesMap.set(category, (categorySalesMap.get(category) ?? 0) + sale.totalAmount);
      }
      const categorySales = [...categorySalesMap.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5);

      return {
        period,
        periodMeta: this.periods.find((item) => item.key === period) ?? this.periods[0],
        dateRange: {
          currentStart,
          currentEnd,
          previousStart,
          previousEnd
        },
        summary: {
          salesAmount: currentSalesAmount,
          commissionGenerated: currentCommission,
          commissionPaid: currentCommissionPaid,
          commissionPending: Math.max(currentCommission - currentCommissionPaid, 0),
          unitsSold: currentUnitsSold,
          orderCount,
          averageTicket,
          lowStockCount,
          outOfStockCount,
          activeProducts,
          salesDeltaPct,
          salesDeltaComparable: salesDeltaPct !== null,
          salesDeltaPctAbs: Math.abs(salesDeltaPct ?? 0)
        },
        topProducts,
        sellers,
        charts: {
          trend: buildTrendChart(trendBuckets),
          sellerSales: buildSellerChart(sellers),
          categorySales: buildCategorySalesDonut(categorySales)
        },
        quickInsights: buildInsights({
          period,
          currentSales,
          currentSalesAmount,
          sellers,
          topProducts,
          lowStockCount,
          outOfStockCount
        })
      };
    })
  );

  setPeriod(period: DashboardPeriod): void {
    this.period$.next(period);
  }
}

function buildTrendChart(
  buckets: Array<{ label: string; sales: number; commissions: number }>
): TrendChartConfig {
  return {
    series: [
      { name: 'Ventas', data: buckets.map((item) => round2(item.sales)) },
      { name: 'Comision', data: buckets.map((item) => round2(item.commissions)) }
    ],
    chart: {
      type: 'area',
      height: 320,
      toolbar: { show: false },
      fontFamily: 'inherit'
    },
    xaxis: {
      categories: buckets.map((item) => item.label),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        style: {
          colors: Array(buckets.length).fill('#786c88'),
          fontSize: '11px'
        }
      }
    },
    yaxis: {
      labels: {
        formatter: (value: number) => compactMoney(value),
        style: { colors: '#786c88', fontSize: '11px' }
      }
    },
    grid: {
      borderColor: '#eee3fb',
      strokeDashArray: 4,
      padding: { left: 4, right: 8 }
    },
    stroke: {
      curve: 'smooth',
      width: [3, 2]
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 0.15,
        opacityFrom: 0.35,
        opacityTo: 0.03,
        stops: [0, 90, 100]
      }
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: (value: number) => `$${round2(value).toLocaleString('es-MX')}`
      }
    },
    dataLabels: { enabled: false },
    colors: ['#6F3BFF', '#F28A3B'],
    legend: {
      show: true,
      position: 'top',
      horizontalAlign: 'right',
      labels: { colors: '#695d7c' as any }
    }
  };
}

function buildSellerChart(
  sellers: Array<{ seller: string; sales: number }>
): BarChartConfig {
  return {
    series: [{ name: 'Ventas', data: sellers.map((item) => round2(item.sales)) }],
    chart: {
      type: 'bar',
      height: Math.max(260, sellers.length * 50),
      toolbar: { show: false },
      fontFamily: 'inherit'
    },
    plotOptions: {
      bar: {
        horizontal: true,
        borderRadius: 8,
        borderRadiusApplication: 'end',
        distributed: true,
        barHeight: '48%'
      }
    },
    xaxis: {
      categories: sellers.map((item) => item.seller),
      labels: {
        formatter: (value: string) => compactMoney(Number(value)),
        style: { colors: Array(sellers.length).fill('#796d8a'), fontSize: '11px' }
      },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    grid: {
      borderColor: '#efe4fb',
      strokeDashArray: 4
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: (value: number) => `$${round2(value).toLocaleString('es-MX')}`
      }
    },
    dataLabels: {
      enabled: true,
      formatter: (value: number) => compactMoney(value),
      style: { fontWeight: 700, colors: ['#2a1d39'] }
    },
    stroke: {
      show: true,
      width: 1,
      colors: ['rgba(255,255,255,0.7)']
    },
    colors: ['#7A46FF', '#A66EFF', '#5FD8B8', '#F5A363', '#EF6E92', '#86B6FF'],
    legend: { show: false }
  };
}

function buildCategorySalesDonut(
  categorySales: Array<[string, number]>
): DonutConfig {
  const labels = categorySales.map(([label]) => label);
  const series = categorySales.map(([, value]) => round2(value)) as ApexNonAxisChartSeries;
  return {
    series,
    chart: {
      type: 'donut',
      height: 310,
      toolbar: { show: false },
      fontFamily: 'inherit'
    },
    labels,
    legend: {
      position: 'bottom',
      labels: { colors: '#726783' as any },
      itemMargin: { horizontal: 10, vertical: 4 }
    },
    dataLabels: {
      enabled: true,
      formatter: (value: number) => `${Math.round(value)}%`,
      style: { fontSize: '11px', fontWeight: 700, colors: ['#fff'] }
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: (value: number) => `$${round2(value).toLocaleString('es-MX')}`
      }
    },
    stroke: { width: 3, colors: ['#fff'] },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 0.12,
        opacityFrom: 1,
        opacityTo: 0.88,
        stops: [0, 100]
      }
    },
    colors: ['#6F3BFF', '#A66EFF', '#F28A3B', '#5FD8B8', '#EF6E92'],
    responsive: [
      {
        breakpoint: 720,
        options: {
          chart: { height: 280 },
          legend: { position: 'bottom' }
        }
      }
    ]
  };
}

function buildInsights(input: {
  period: DashboardPeriod;
  currentSales: SalesRecord[];
  currentSalesAmount: number;
  sellers: Array<{ seller: string; sales: number; tickets: number }>;
  topProducts: Array<{ product: string; sales: number; units: number }>;
  lowStockCount: number;
  outOfStockCount: number;
}): string[] {
  const periodLabel =
    input.period === 'weekly' ? 'semana' : input.period === 'monthly' ? 'mes' : 'año';
  const bestSeller = input.topProducts[0];
  const topSeller = input.sellers[0];
  const insights: string[] = [];

  insights.push(
    `Ventas del ${periodLabel}: $${round2(input.currentSalesAmount).toLocaleString('es-MX')} con ${input.currentSales.length} ticket(s).`
  );

  if (bestSeller) {
    insights.push(
      `Producto top: ${bestSeller.product} (${bestSeller.units} pzas, $${round2(bestSeller.sales).toLocaleString('es-MX')}).`
    );
  }

  if (topSeller) {
    insights.push(
      `Vendedor lider: ${topSeller.seller} con $${round2(topSeller.sales).toLocaleString('es-MX')} en ${topSeller.tickets} venta(s).`
    );
  }

  insights.push(
    `Inventario en alerta: ${input.lowStockCount} producto(s), ${input.outOfStockCount} agotado(s).`
  );

  return insights;
}

function getPeriodRange(period: DashboardPeriod): {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
  bucketLabels: string[];
} {
  const now = new Date();
  const end = endOfDay(new Date(now));

  if (period === 'weekly') {
    const currentStart = startOfDay(addDays(now, -6));
    const previousEnd = endOfDay(addDays(currentStart, -1));
    const previousStart = startOfDay(addDays(previousEnd, -6));
    return {
      currentStart,
      currentEnd: end,
      previousStart,
      previousEnd,
      bucketLabels: Array.from({ length: 7 }, (_, i) => formatShortDay(addDays(currentStart, i)))
    };
  }

  if (period === 'monthly') {
    const currentStart = startOfMonth(now);
    const previousStart = startOfMonth(addMonths(now, -1));
    const previousEnd = endOfMonth(addMonths(now, -1));
    const labels = Array.from(
      { length: daysInMonth(currentStart) },
      (_, i) => String(i + 1).padStart(2, '0')
    );
    return {
      currentStart,
      currentEnd: end,
      previousStart,
      previousEnd,
      bucketLabels: labels
    };
  }

  const currentStart = startOfYear(now);
  const previousStart = startOfYear(new Date(now.getFullYear() - 1, 0, 1));
  const previousEnd = endOfYear(new Date(now.getFullYear() - 1, 0, 1));
  return {
    currentStart,
    currentEnd: end,
    previousStart,
    previousEnd,
    bucketLabels: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  };
}

function getBucketLabelForDate(date: Date | null, period: DashboardPeriod): string | null {
  if (!date) return null;
  if (period === 'weekly') return formatShortDay(date);
  if (period === 'monthly') return String(date.getDate()).padStart(2, '0');
  return ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][date.getMonth()];
}

function isInRange(value: Date | null, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = value.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function startOfDay(date: Date): Date {
  const clone = new Date(date);
  clone.setHours(0, 0, 0, 0);
  return clone;
}

function endOfDay(date: Date): Date {
  const clone = new Date(date);
  clone.setHours(23, 59, 59, 999);
  return clone;
}

function addDays(date: Date, days: number): Date {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + days);
  return clone;
}

function addMonths(date: Date, months: number): Date {
  const clone = new Date(date);
  clone.setMonth(clone.getMonth() + months);
  return clone;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function endOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function formatShortDay(date: Date): string {
  return ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'][date.getDay()];
}

function calcDeltaPct(previous: number, current: number): number | null {
  if (previous <= 0 && current <= 0) return 0;
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((sum, item) => sum + Number(pick(item) || 0), 0);
}

function round2(value: number): number {
  return Number((value || 0).toFixed(2));
}

function compactMoney(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}
