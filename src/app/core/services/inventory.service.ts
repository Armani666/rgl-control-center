import { Injectable } from '@angular/core';
import { Observable, Subject, from, merge, switchMap, timer } from 'rxjs';

import { CreateInventoryMovementInput, InventoryMovement } from '../../shared/models/inventory-movement.model';
import { StockRecord } from '../../shared/models/stock.model';
import { assertSupabaseConfigured, supabase } from '../supabase/supabase';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly refresh$ = new Subject<void>();

  getAllStock$(): Observable<StockRecord[]> {
    return this.poll(() => this.fetchAllStock());
  }

  getStockByProduct$(productId: string): Observable<StockRecord | null> {
    return this.poll(() => this.fetchStockByProduct(productId));
  }

  getMovementsByProduct$(productId: string): Observable<InventoryMovement[]> {
    return this.poll(() => this.fetchMovementsByProduct(productId));
  }

  getAllMovements$(): Observable<InventoryMovement[]> {
    return this.poll(() => this.fetchAllMovements());
  }

  async createMovement(input: CreateInventoryMovementInput): Promise<void> {
    assertSupabaseConfigured();

    const quantity = Math.floor(Number(input.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('La cantidad debe ser mayor a cero.');
    }

    const { error } = await supabase.rpc('record_inventory_movement', {
      p_product_id: input.productId,
      p_type: input.type,
      p_quantity: quantity,
      p_reason: input.reason.trim(),
      p_note: input.note.trim()
    });

    if (error) {
      throw new Error(error.message);
    }

    this.refresh$.next();
  }

  private async fetchAllStock(): Promise<StockRecord[]> {
    assertSupabaseConfigured();

    const { data, error } = await supabase.from('stock').select('*');
    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: unknown) => this.mapStock(row as Record<string, unknown>));
  }

  private async fetchStockByProduct(productId: string): Promise<StockRecord | null> {
    assertSupabaseConfigured();

    const { data, error } = await supabase
      .from('stock')
      .select('*')
      .eq('product_id', productId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data ? this.mapStock(data as Record<string, unknown>) : null;
  }

  private async fetchMovementsByProduct(productId: string): Promise<InventoryMovement[]> {
    assertSupabaseConfigured();

    const { data, error } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: unknown) => this.mapMovement(row as Record<string, unknown>));
  }

  private async fetchAllMovements(): Promise<InventoryMovement[]> {
    assertSupabaseConfigured();

    const { data, error } = await supabase
      .from('inventory_movements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: unknown) => this.mapMovement(row as Record<string, unknown>));
  }

  private poll<T>(loader: () => Promise<T>): Observable<T> {
    return merge(timer(0, 5000), this.refresh$).pipe(switchMap(() => from(loader())));
  }

  private mapStock(row: Record<string, unknown>): StockRecord {
    return {
      productId: String(row['product_id'] ?? ''),
      quantity: Number(row['quantity'] ?? 0),
      minStock: Number(row['min_stock'] ?? 0),
      updatedAt: toDate(row['updated_at'])
    };
  }

  private mapMovement(row: Record<string, unknown>): InventoryMovement {
    return {
      id: String(row['id'] ?? ''),
      productId: String(row['product_id'] ?? ''),
      type: row['type'] === 'OUT' ? 'OUT' : 'IN',
      quantity: Number(row['quantity'] ?? 0),
      reason: String(row['reason'] ?? ''),
      note: String(row['note'] ?? ''),
      stockBefore: row['stock_before'] == null ? null : Number(row['stock_before'] ?? 0),
      stockAfter: row['stock_after'] == null ? null : Number(row['stock_after'] ?? 0),
      createdBy: row['created_by'] == null ? '' : String(row['created_by'] ?? ''),
      createdByEmail: row['created_by_email'] == null ? '' : String(row['created_by_email'] ?? ''),
      createdAt: toDate(row['created_at'])
    };
  }
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
