import { Injectable } from '@angular/core';
import { Observable, Subject, from, merge, switchMap, timer } from 'rxjs';

import {
  CommissionPayment,
  CommissionPaymentPayload,
  SalesRecord,
  SalesRecordPayload
} from '../../shared/models/sales-commission.model';
import { assertSupabaseConfigured, supabase } from '../supabase/supabase';

@Injectable({ providedIn: 'root' })
export class SalesCommissionService {
  private readonly refresh$ = new Subject<void>();

  getSalesRecords$(): Observable<SalesRecord[]> {
    return this.poll(() => this.fetchSalesRecords());
  }

  getCommissionPayments$(): Observable<CommissionPayment[]> {
    return this.poll(() => this.fetchCommissionPayments());
  }

  async createSalesRecord(payload: SalesRecordPayload): Promise<void> {
    assertSupabaseConfigured();

    const quantity = Math.max(1, Math.floor(Number(payload.quantity)));
    const totalAmount = Number(payload.totalAmount);
    const commissionRate = Number(payload.commissionRate);
    if (!payload.sellerProfileId) throw new Error('Selecciona un vendedor.');
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) throw new Error('Total invalido.');
    if (!Number.isFinite(commissionRate) || commissionRate < 0) throw new Error('Comision invalida.');

    const commissionAmount = Number(((totalAmount * commissionRate) / 100).toFixed(2));

    const { error } = await supabase.from('sales_records').insert({
      seller_profile_id: payload.sellerProfileId,
      customer_name: payload.customerName?.trim() || null,
      customer_phone: payload.customerPhone?.trim() || null,
      product_id: payload.productId || null,
      product_name: payload.productName.trim() || null,
      quantity,
      total_amount: totalAmount,
      commission_rate: commissionRate,
      commission_amount: commissionAmount,
      sale_date: payload.saleDate,
      note: payload.note.trim() || null
    });

    if (error) throw new Error(error.message);
    this.refresh$.next();
  }

  async createCommissionPayment(payload: CommissionPaymentPayload): Promise<void> {
    assertSupabaseConfigured();

    const amount = Number(payload.amount);
    if (!payload.sellerProfileId) throw new Error('Selecciona un vendedor.');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Monto invalido.');

    const { error } = await supabase.from('commission_payments').insert({
      seller_profile_id: payload.sellerProfileId,
      amount,
      payment_date: payload.paymentDate,
      note: payload.note.trim() || null
    });

    if (error) throw new Error(error.message);
    this.refresh$.next();
  }

  private async fetchSalesRecords(): Promise<SalesRecord[]> {
    assertSupabaseConfigured();
    const { data, error } = await supabase
      .from('sales_records')
      .select('*')
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => mapSalesRecord(row as Record<string, unknown>));
  }

  private async fetchCommissionPayments(): Promise<CommissionPayment[]> {
    assertSupabaseConfigured();
    const { data, error } = await supabase
      .from('commission_payments')
      .select('*')
      .order('payment_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => mapCommissionPayment(row as Record<string, unknown>));
  }

  private poll<T>(loader: () => Promise<T>): Observable<T> {
    return merge(timer(0, 7000), this.refresh$).pipe(switchMap(() => from(loader())));
  }
}

function mapSalesRecord(row: Record<string, unknown>): SalesRecord {
  return {
    id: String(row['id'] ?? ''),
    sellerProfileId: String(row['seller_profile_id'] ?? ''),
    sellerName: String(row['seller_name'] ?? ''),
    sellerEmail: String(row['seller_email'] ?? ''),
    customerName: String(row['customer_name'] ?? ''),
    customerPhone: String(row['customer_phone'] ?? ''),
    productId: row['product_id'] == null ? null : String(row['product_id'] ?? ''),
    productName: String(row['product_name'] ?? ''),
    quantity: Number(row['quantity'] ?? 1),
    totalAmount: Number(row['total_amount'] ?? 0),
    commissionRate: Number(row['commission_rate'] ?? 0),
    commissionAmount: Number(row['commission_amount'] ?? 0),
    saleDate: toDate(row['sale_date']),
    note: String(row['note'] ?? ''),
    createdAt: toDate(row['created_at'])
  };
}

function mapCommissionPayment(row: Record<string, unknown>): CommissionPayment {
  return {
    id: String(row['id'] ?? ''),
    sellerProfileId: String(row['seller_profile_id'] ?? ''),
    amount: Number(row['amount'] ?? 0),
    paymentDate: toDate(row['payment_date']),
    note: String(row['note'] ?? ''),
    createdAt: toDate(row['created_at'])
  };
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
