import { Injectable } from '@angular/core';
import { Observable, Subject, from, merge, switchMap, timer } from 'rxjs';

import { Product, ProductPayload } from '../../shared/models/product.model';
import { assertSupabaseConfigured, supabase } from '../supabase/supabase';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private readonly refresh$ = new Subject<void>();

  getProducts$(): Observable<Product[]> {
    return this.poll(() => this.fetchProducts());
  }

  getProduct$(id: string): Observable<Product | null> {
    return this.poll(() => this.getProductOnce(id));
  }

  async getProductOnce(id: string): Promise<Product | null> {
    assertSupabaseConfigured();

    const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
    if (error) {
      throw new Error(error.message);
    }

    return data ? this.mapProduct(data as Record<string, unknown>) : null;
  }

  async saveProduct(payload: ProductPayload, id?: string): Promise<string> {
    assertSupabaseConfigured();

    const now = new Date().toISOString();
    const normalized = {
      sku: payload.sku.trim(),
      name: payload.name.trim(),
      category: payload.category.trim() || null,
      description: payload.description.trim(),
      price: Number(payload.price),
      min_stock: Number(payload.minStock),
      active: payload.active,
      updated_at: now
    };

    if (id) {
      const { error: productError } = await supabase.from('products').update(normalized).eq('id', id);
      if (productError) {
        throw new Error(productError.message);
      }

      const { error: stockError } = await supabase.from('stock').upsert(
        {
          product_id: id,
          min_stock: normalized.min_stock,
          updated_at: now
        },
        { onConflict: 'product_id' }
      );
      if (stockError) {
        throw new Error(stockError.message);
      }

      this.refresh$.next();
      return id;
    }

    const { data: created, error: createError } = await supabase
      .from('products')
      .insert({
        ...normalized,
        created_at: now
      })
      .select('id')
      .single();

    if (createError) {
      throw new Error(createError.message);
    }

    const createdId = String((created as { id: string }).id);

    const { error: stockCreateError } = await supabase.from('stock').upsert(
      {
        product_id: createdId,
        quantity: 0,
        min_stock: normalized.min_stock,
        updated_at: now
      },
      { onConflict: 'product_id' }
    );
    if (stockCreateError) {
      throw new Error(stockCreateError.message);
    }

    this.refresh$.next();
    return createdId;
  }

  private async fetchProducts(): Promise<Product[]> {
    assertSupabaseConfigured();

    const { data, error } = await supabase.from('products').select('*').order('name', { ascending: true });
    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: unknown) => this.mapProduct(row as Record<string, unknown>));
  }

  private poll<T>(loader: () => Promise<T>): Observable<T> {
    return merge(timer(0, 5000), this.refresh$).pipe(switchMap(() => from(loader())));
  }

  private mapProduct(row: Record<string, unknown>): Product {
    return {
      id: String(row['id'] ?? ''),
      sku: String(row['sku'] ?? ''),
      name: String(row['name'] ?? ''),
      category: String(row['category'] ?? ''),
      description: String(row['description'] ?? ''),
      price: Number(row['price'] ?? 0),
      minStock: Number(row['min_stock'] ?? 0),
      active: Boolean(row['active'] ?? true),
      createdAt: toDate(row['created_at']),
      updatedAt: toDate(row['updated_at'])
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
