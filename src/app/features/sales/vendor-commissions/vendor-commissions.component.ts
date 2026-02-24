import {
  AsyncPipe,
  CurrencyPipe,
  DatePipe,
  DecimalPipe,
  NgClass,
  NgFor,
  NgIf
} from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { combineLatest, map, startWith } from 'rxjs';

import { ProductService } from '../../../core/services/product.service';
import { SalesCommissionService } from '../../../core/services/sales-commission.service';
import { UserAdminService } from '../../../core/services/user-admin.service';

const BASE_COMMISSION_RATE = 10;
const GOAL_COMMISSION_RATE = 15;

@Component({
  selector: 'app-vendor-commissions',
  imports: [
    AsyncPipe,
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    NgClass,
    NgFor,
    NgIf,
    ReactiveFormsModule
  ],
  templateUrl: './vendor-commissions.component.html',
  styleUrl: './vendor-commissions.component.scss'
})
export class VendorCommissionsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly salesCommissionService = inject(SalesCommissionService);
  private readonly userAdminService = inject(UserAdminService);
  private readonly productService = inject(ProductService);
  private readonly destroyRef = inject(DestroyRef);

  readonly saleForm = this.fb.nonNullable.group({
    sellerProfileId: ['', Validators.required],
    goalReached: [false],
    customerName: [''],
    customerPhone: [''],
    productId: [''],
    productName: [''],
    quantity: [1, [Validators.required, Validators.min(1)]],
    totalAmount: [0, [Validators.required, Validators.min(0.01)]],
    commissionRate: [BASE_COMMISSION_RATE, [Validators.required, Validators.min(0)]],
    saleDate: [todayIsoLocal(), Validators.required],
    note: ['', [Validators.maxLength(300)]]
  });

  readonly paymentForm = this.fb.nonNullable.group({
    sellerProfileId: ['', Validators.required],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    paymentDate: [todayIsoLocal(), Validators.required],
    note: ['', [Validators.maxLength(300)]]
  });

  readonly filterForm = this.fb.nonNullable.group({
    sellerProfileId: ['all'],
    dateFrom: [firstDayOfMonthIso()],
    dateTo: [todayIsoLocal()]
  });

  savingSale = false;
  savingPayment = false;
  errorMessage = '';
  successMessage = '';
  private sellerDefaultRates = new Map<string, number>();

  readonly dashboard$ = combineLatest([
    this.salesCommissionService.getSalesRecords$(),
    this.salesCommissionService.getCommissionPayments$(),
    this.userAdminService.getProfiles$(),
    this.productService.getProducts$(),
    this.filterForm.valueChanges.pipe(
      startWith(this.filterForm.getRawValue()),
      map(() => this.filterForm.getRawValue())
    )
  ]).pipe(
    map(([sales, payments, profiles, products, filters]) =>
      buildVm({
        sales,
        payments,
        profiles,
        products,
        filters: {
          sellerProfileId: filters.sellerProfileId || 'all',
          dateFrom: filters.dateFrom || '',
          dateTo: filters.dateTo || ''
        }
      })
    )
  );

  constructor() {
    this.userAdminService
      .getProfiles$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((profiles) => {
        this.sellerDefaultRates = new Map(
          profiles.map((profile) => [profile.id, Number((profile as any).commissionRate ?? BASE_COMMISSION_RATE)])
        );
        this.applyCommissionPreset();
      });

    this.saleForm.controls.sellerProfileId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyCommissionPreset());

    this.saleForm.controls.goalReached.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.applyCommissionPreset());
  }

  get estimatedCommission(): number {
    const raw = this.saleForm.getRawValue();
    const total = Number(raw.totalAmount || 0);
    const rate = Number(raw.commissionRate || 0);
    return Number.isFinite(total) && Number.isFinite(rate) ? Number(((total * rate) / 100).toFixed(2)) : 0;
  }

  async submitSale(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    this.saleForm.markAllAsTouched();
    if (this.saleForm.invalid) return;

    const raw = this.saleForm.getRawValue();
    this.savingSale = true;
    try {
      await this.salesCommissionService.createSalesRecord({
        sellerProfileId: raw.sellerProfileId,
        customerName: raw.customerName,
        customerPhone: raw.customerPhone,
        productId: raw.productId || null,
        productName: raw.productName,
        quantity: raw.quantity,
        totalAmount: raw.totalAmount,
        commissionRate: raw.commissionRate,
        saleDate: raw.saleDate,
        note: raw.note
      });
      this.successMessage = 'Venta registrada y comision calculada.';
      this.saleForm.patchValue({
        goalReached: false,
        customerName: '',
        customerPhone: '',
        productId: '',
        productName: '',
        quantity: 1,
        totalAmount: 0,
        commissionRate: BASE_COMMISSION_RATE,
        note: '',
        saleDate: todayIsoLocal()
      });
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo guardar la venta.';
    } finally {
      this.savingSale = false;
    }
  }

  async submitPayment(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    this.paymentForm.markAllAsTouched();
    if (this.paymentForm.invalid) return;

    const raw = this.paymentForm.getRawValue();
    this.savingPayment = true;
    try {
      await this.salesCommissionService.createCommissionPayment({
        sellerProfileId: raw.sellerProfileId,
        amount: raw.amount,
        paymentDate: raw.paymentDate,
        note: raw.note
      });
      this.successMessage = 'Pago de comision registrado.';
      this.paymentForm.patchValue({
        amount: 0,
        note: '',
        paymentDate: todayIsoLocal()
      });
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo guardar el pago.';
    } finally {
      this.savingPayment = false;
    }
  }

  exportCsv(vm: VendorCommissionVm): void {
    const rows = [
      ['Vendedor', 'Ventas', 'Comision', 'Pagado', 'Pendiente'],
      ...vm.sellerSummary.map((item) => [
        item.sellerName,
        toMoney(item.salesTotal),
        toMoney(item.commissionTotal),
        toMoney(item.paidTotal),
        toMoney(item.pending)
      ]),
      [],
      ['Detalle'],
      ['Fecha', 'Vendedor', 'Producto', 'Total venta', 'Comision', 'Tasa %', 'Nota'],
      ...vm.salesRows.map((row) => [
        row.saleDate ? formatDate(row.saleDate) : '',
        row.sellerName,
        row.productName || 'Venta manual',
        toMoney(row.totalAmount),
        toMoney(row.commissionAmount),
        row.commissionRate.toFixed(2),
        sanitizeCsv(row.note)
      ])
    ];

    const csv = rows
      .map((line) => line.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const sellerLabel = vm.filters.sellerProfileId === 'all' ? 'todos' : vm.filters.sellerLabel;
    a.href = url;
    a.download = `comisiones-${slugify(sellerLabel)}-${vm.filters.dateFrom || 'inicio'}-${vm.filters.dateTo || 'hoy'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportClientReceiptPdf(row: any): void {
    const saleDate = row.saleDate instanceof Date ? row.saleDate : null;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      this.errorMessage = 'No se pudo abrir la ventana para generar el PDF.';
      return;
    }

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Nota de venta ${escapeHtml(row.id || '')}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; background: #f7f3ef; color: #2a211b; }
          .sheet { max-width: 760px; margin: 24px auto; background: #fff; border: 1px solid #eadfd5; border-radius: 16px; overflow: hidden; }
          .head { padding: 20px 24px; background: linear-gradient(180deg,#fff7f4,#fff); border-bottom: 1px solid #f0e4da; }
          .brand { margin: 0; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #9b5a44; font-weight: 700; }
          h1 { margin: 6px 0 0; font-size: 24px; }
          .muted { margin: 4px 0 0; color: #6d6056; font-size: 13px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 18px 24px; }
          .card { border: 1px solid #eee2d7; border-radius: 12px; padding: 12px; background: #fffdfa; }
          .label { margin: 0; color: #7d6f64; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
          .value { margin: 4px 0 0; font-weight: 700; }
          table { width: calc(100% - 48px); margin: 0 24px 18px; border-collapse: collapse; }
          th, td { padding: 10px 8px; border-bottom: 1px solid #efe4da; text-align: left; }
          th { font-size: 11px; color: #7d6f64; text-transform: uppercase; letter-spacing: .08em; background: #fffaf6; }
          .totals { margin: 0 24px 24px auto; width: 280px; border: 1px solid #ecdccd; border-radius: 12px; padding: 12px; background: #fffaf8; }
          .row { display:flex; justify-content:space-between; gap:8px; margin: 6px 0; }
          .row strong { font-size: 18px; }
          .foot { padding: 0 24px 24px; color: #7a6b60; font-size: 12px; }
          @media print { body { background: #fff; } .sheet { margin: 0; border: none; border-radius: 0; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          <div class="head">
            <p class="brand">Rose Gold Lexury</p>
            <h1>Nota de venta</h1>
            <p class="muted">Comprobante de compra para cliente</p>
          </div>
          <div class="grid">
            <div class="card">
              <p class="label">Cliente</p>
              <p class="value">${escapeHtml(row.customerName || 'Cliente mostrador')}</p>
              <p class="muted">${escapeHtml(row.customerPhone || '')}</p>
            </div>
            <div class="card">
              <p class="label">Detalle</p>
              <p class="value">Folio: ${escapeHtml(String(row.id || '').slice(0, 8).toUpperCase())}</p>
              <p class="muted">Fecha: ${escapeHtml(saleDate ? formatDateHuman(saleDate) : '-')}</p>
              <p class="muted">Vendedor: ${escapeHtml(row.sellerName || '')}</p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${escapeHtml(row.productName || 'Venta general')}</td>
                <td>${escapeHtml(String(row.quantity ?? 1))}</td>
                <td>$${toMoney(Number(row.totalAmount ?? 0))}</td>
              </tr>
            </tbody>
          </table>
          <div class="totals">
            <div class="row"><span>Total</span><strong>$${toMoney(Number(row.totalAmount ?? 0))}</strong></div>
          </div>
          <div class="foot">
            Gracias por tu compra. Conserva este comprobante para aclaraciones.
          </div>
        </div>
        <script>
          window.onload = function () { setTimeout(function(){ window.print(); }, 200); };
        </script>
      </body>
      </html>
    `;

    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  private applyCommissionPreset(): void {
    if (this.saleForm.controls.commissionRate.dirty) {
      return;
    }

    const sellerId = this.saleForm.controls.sellerProfileId.value;
    const goalReached = this.saleForm.controls.goalReached.value;
    const sellerRate = this.sellerDefaultRates.get(sellerId);
    const baseRate = Number.isFinite(sellerRate as number) ? Number(sellerRate) : BASE_COMMISSION_RATE;
    const rate = goalReached ? GOAL_COMMISSION_RATE : baseRate;
    this.saleForm.patchValue({ commissionRate: rate }, { emitEvent: false });
  }
}

interface BuildVmInput {
  sales: Array<any>;
  payments: Array<any>;
  profiles: Array<any>;
  products: Array<any>;
  filters: {
    sellerProfileId: string;
    dateFrom: string;
    dateTo: string;
  };
}

interface SellerSummaryRow {
  sellerProfileId: string;
  sellerName: string;
  sellerEmail: string;
  salesCount: number;
  salesTotal: number;
  commissionTotal: number;
  paidTotal: number;
  pending: number;
}

interface VendorCommissionVm {
  filters: {
    sellerProfileId: string;
    sellerLabel: string;
    dateFrom: string;
    dateTo: string;
  };
  products: Array<{ id: string; name: string; sku: string }>;
  sellers: Array<{ id: string; label: string; email: string; defaultRate: number }>;
  salesRows: Array<any>;
  paymentRows: Array<any>;
  sellerSummary: SellerSummaryRow[];
  summary: {
    totalSalesAmount: number;
    totalCommission: number;
    totalPaid: number;
    totalPending: number;
    salesCount: number;
  };
}

function buildVm(input: BuildVmInput): VendorCommissionVm {
  const sellers = input.profiles
    .filter((p) => p.active)
    .map((p) => ({
      id: p.id as string,
      label: ((p.fullName as string) || (p.email as string) || 'Vendedor').trim(),
      email: (p.email as string) || '',
      defaultRate: Number((p as any).commissionRate ?? BASE_COMMISSION_RATE)
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const sellerById = new Map(sellers.map((s) => [s.id, s]));

  const dateFrom = input.filters.dateFrom ? startOfDay(new Date(`${input.filters.dateFrom}T00:00:00`)) : null;
  const dateTo = input.filters.dateTo ? endOfDay(new Date(`${input.filters.dateTo}T00:00:00`)) : null;
  const selectedSellerId = input.filters.sellerProfileId || 'all';

  const salesRows = input.sales.filter((row) => {
    const saleDate = row.saleDate instanceof Date ? row.saleDate : null;
    const sellerOk = selectedSellerId === 'all' || row.sellerProfileId === selectedSellerId;
    const fromOk = !dateFrom || (saleDate && saleDate.getTime() >= dateFrom.getTime());
    const toOk = !dateTo || (saleDate && saleDate.getTime() <= dateTo.getTime());
    return sellerOk && fromOk && toOk;
  });

  const paymentRows = input.payments.filter((row) => {
    const paymentDate = row.paymentDate instanceof Date ? row.paymentDate : null;
    const sellerOk = selectedSellerId === 'all' || row.sellerProfileId === selectedSellerId;
    const fromOk = !dateFrom || (paymentDate && paymentDate.getTime() >= dateFrom.getTime());
    const toOk = !dateTo || (paymentDate && paymentDate.getTime() <= dateTo.getTime());
    return sellerOk && fromOk && toOk;
  });

  const sellerSummaryMap = new Map<string, SellerSummaryRow>();
  for (const sale of salesRows) {
    const seller = sellerById.get(sale.sellerProfileId);
    const current =
      sellerSummaryMap.get(sale.sellerProfileId) ??
      {
        sellerProfileId: sale.sellerProfileId,
        sellerName: sale.sellerName || seller?.label || 'Vendedor',
        sellerEmail: sale.sellerEmail || seller?.email || '',
        salesCount: 0,
        salesTotal: 0,
        commissionTotal: 0,
        paidTotal: 0,
        pending: 0
      };
    current.salesCount += 1;
    current.salesTotal += Number(sale.totalAmount ?? 0);
    current.commissionTotal += Number(sale.commissionAmount ?? 0);
    sellerSummaryMap.set(sale.sellerProfileId, current);
  }

  for (const payment of paymentRows) {
    const seller = sellerById.get(payment.sellerProfileId);
    const current =
      sellerSummaryMap.get(payment.sellerProfileId) ??
      {
        sellerProfileId: payment.sellerProfileId,
        sellerName: seller?.label || 'Vendedor',
        sellerEmail: seller?.email || '',
        salesCount: 0,
        salesTotal: 0,
        commissionTotal: 0,
        paidTotal: 0,
        pending: 0
      };
    current.paidTotal += Number(payment.amount ?? 0);
    sellerSummaryMap.set(payment.sellerProfileId, current);
  }

  const sellerSummary = [...sellerSummaryMap.values()]
    .map((item) => ({ ...item, pending: Number((item.commissionTotal - item.paidTotal).toFixed(2)) }))
    .sort((a, b) => b.pending - a.pending || b.commissionTotal - a.commissionTotal || a.sellerName.localeCompare(b.sellerName));

  const totalSalesAmount = salesRows.reduce((sum, item) => sum + Number(item.totalAmount ?? 0), 0);
  const totalCommission = salesRows.reduce((sum, item) => sum + Number(item.commissionAmount ?? 0), 0);
  const totalPaid = paymentRows.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const totalPending = Number((totalCommission - totalPaid).toFixed(2));

  const sellerLabel = selectedSellerId === 'all' ? 'Todos' : (sellerById.get(selectedSellerId)?.label ?? 'Vendedor');

  return {
    filters: {
      sellerProfileId: selectedSellerId,
      sellerLabel,
      dateFrom: input.filters.dateFrom,
      dateTo: input.filters.dateTo
    },
    products: input.products
      .filter((p) => p.active)
      .map((p) => ({ id: p.id, name: p.name, sku: p.sku }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    sellers,
    salesRows,
    paymentRows,
    sellerSummary,
    summary: {
      totalSalesAmount,
      totalCommission,
      totalPaid,
      totalPending,
      salesCount: salesRows.length
    }
  };
}

function todayIsoLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function firstDayOfMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function startOfDay(date: Date): Date {
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(date: Date): Date {
  date.setHours(23, 59, 59, 999);
  return date;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toMoney(value: number): string {
  return Number(value || 0).toFixed(2);
}

function sanitizeCsv(value: string): string {
  return (value || '').replace(/\r?\n/g, ' ');
}

function slugify(value: string): string {
  return (value || 'export')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDateHuman(date: Date): string {
  return date.toLocaleDateString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
