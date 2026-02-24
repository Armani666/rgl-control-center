import { Injectable } from '@angular/core';
import { Observable, Subject, from, merge, switchMap, timer } from 'rxjs';

import {
  ProductSupplierLink,
  Supplier,
  SupplierPayload
} from '../../shared/models/supplier.model';
import { assertSupabaseConfigured, supabase } from '../supabase/supabase';

@Injectable({ providedIn: 'root' })
export class SupplierService {
  private readonly refresh$ = new Subject<void>();

  getSuppliers$(): Observable<Supplier[]> {
    return this.poll(() => this.fetchSuppliers());
  }

  getProductSupplierLinks$(): Observable<ProductSupplierLink[]> {
    return this.poll(() => this.fetchProductSupplierLinks());
  }

  async saveSupplier(payload: SupplierPayload, id?: string): Promise<string> {
    assertSupabaseConfigured();
    const now = new Date().toISOString();
    const normalized = {
      name: payload.name.trim(),
      contact_name: payload.contactName.trim() || null,
      email: payload.email.trim() || null,
      phone: payload.phone.trim() || null,
      lead_time_days: Math.max(0, Math.floor(Number(payload.leadTimeDays || 0))),
      active: payload.active,
      notes: payload.notes.trim(),
      updated_at: now
    };

    if (id) {
      const { error } = await supabase.from('suppliers').update(normalized).eq('id', id);
      if (error) {
        throw new Error(error.message);
      }
      this.refresh$.next();
      return id;
    }

    const { data, error } = await supabase
      .from('suppliers')
      .insert({ ...normalized, created_at: now })
      .select('id')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    this.refresh$.next();
    return String((data as { id: string }).id);
  }

  async saveProductSupplierLink(link: ProductSupplierLink): Promise<void> {
    assertSupabaseConfigured();
    const payload = {
      product_id: link.productId,
      supplier_id: link.supplierId,
      supplier_sku: link.supplierSku.trim() || null,
      cost: Number(link.cost || 0),
      min_order_qty: Math.max(1, Math.floor(Number(link.minOrderQty || 1))),
      preferred: Boolean(link.preferred),
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('product_suppliers')
      .upsert(payload, { onConflict: 'product_id,supplier_id' });

    if (error) {
      throw new Error(error.message);
    }

    this.refresh$.next();
  }

  private async fetchSuppliers(): Promise<Supplier[]> {
    assertSupabaseConfigured();
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapSupplier(row as Record<string, unknown>));
  }

  private async fetchProductSupplierLinks(): Promise<ProductSupplierLink[]> {
    assertSupabaseConfigured();
    const { data, error } = await supabase
      .from('product_suppliers')
      .select('*')
      .order('preferred', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapProductSupplierLink(row as Record<string, unknown>));
  }

  private poll<T>(loader: () => Promise<T>): Observable<T> {
    return merge(timer(0, 7000), this.refresh$).pipe(switchMap(() => from(loader())));
  }
}

function mapSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: String(row['id'] ?? ''),
    name: String(row['name'] ?? ''),
    contactName: String(row['contact_name'] ?? ''),
    email: String(row['email'] ?? ''),
    phone: String(row['phone'] ?? ''),
    leadTimeDays: Number(row['lead_time_days'] ?? 0),
    active: Boolean(row['active'] ?? true),
    notes: String(row['notes'] ?? ''),
    createdAt: toDate(row['created_at']),
    updatedAt: toDate(row['updated_at'])
  };
}

function mapProductSupplierLink(row: Record<string, unknown>): ProductSupplierLink {
  return {
    productId: String(row['product_id'] ?? ''),
    supplierId: String(row['supplier_id'] ?? ''),
    supplierSku: String(row['supplier_sku'] ?? ''),
    cost: Number(row['cost'] ?? 0),
    minOrderQty: Number(row['min_order_qty'] ?? 1),
    preferred: Boolean(row['preferred'] ?? false),
    updatedAt: toDate(row['updated_at'])
  };
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
