import { Injectable } from '@angular/core';
import { Observable, Subject, from, merge, switchMap, timer } from 'rxjs';

import { Product, ProductPayload } from '../../shared/models/product.model';
import { assertSupabaseConfigured, supabase } from '../supabase/supabase';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private static readonly PRODUCT_IMAGES_BUCKET = 'products';
  private readonly refresh$ = new Subject<void>();

  getProducts$(): Observable<Product[]> {
    return this.poll(() => this.fetchProducts());
  }

  getProduct$(id: string): Observable<Product | null> {
    return this.poll(() => this.getProductOnce(id));
  }

  async getProductOnce(id: string): Promise<Product | null> {
    assertSupabaseConfigured();

    const [{ data, error }, { data: webData, error: webError }] = await Promise.all([
      supabase.from('products').select('*').eq('id', id).maybeSingle(),
      this.getProductWebOnce(id)
    ]);

    if (error) throw new Error(error.message);
    if (webError) throw new Error(webError.message);

    return data
      ? this.mapProduct(data as Record<string, unknown>, (webData as Record<string, unknown> | null) ?? null)
      : null;
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
      cost: payload.cost == null ? null : Number(payload.cost),
      barcode: payload.barcode?.trim() || null,
      brand: payload.brand?.trim() || null,
      unit: payload.unit?.trim() || null,
      location: payload.location?.trim() || null,
      supplier_id: payload.supplierId?.trim() || null,
      lead_time_days: payload.leadTimeDays == null ? null : Number(payload.leadTimeDays),
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

      await this.upsertProductWeb(id, payload, now);

      this.refresh$.next();
      return id;
    }

    const createdId = crypto.randomUUID();

    const { error: createError } = await supabase.from('products').insert({
      id: createdId,
      ...normalized,
      created_at: now
    });

    if (createError) {
      throw new Error(createError.message);
    }

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

    await this.upsertProductWeb(createdId, payload, now);

    this.refresh$.next();
    return createdId;
  }

  async deleteProduct(id: string): Promise<void> {
    assertSupabaseConfigured();

    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      throw new Error(error.message);
    }

    this.refresh$.next();
  }

  async uploadProductImage(file: File, productRef: string, type: 'cover' | 'gallery'): Promise<string> {
    assertSupabaseConfigured();

    const safeRef = sanitizePathSegment(productRef || 'draft');
    const extension = getFileExtension(file.name);
    const fileName =
      type === 'cover'
        ? `cover-${Date.now()}.${extension}`
        : `${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const folder = type === 'cover' ? 'cover' : 'gallery';
    const path = `${safeRef}/${folder}/${fileName}`;

    const { error } = await supabase.storage
      .from(ProductService.PRODUCT_IMAGES_BUCKET)
      .upload(path, file, { upsert: type === 'cover' });

    if (error) {
      throw new Error(error.message);
    }

    const { data } = supabase.storage.from(ProductService.PRODUCT_IMAGES_BUCKET).getPublicUrl(path);
    return data.publicUrl;
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

  private async upsertProductWeb(productId: string, payload: ProductPayload, now: string): Promise<void> {
    const gallery = normalizeStringArray(payload.imageUrls ?? []);
    const colors = normalizeStringArray(payload.colors ?? []);
    const brandPublic = payload.brandPublic?.trim() || payload.brand?.trim() || null;
    const coverImage = pickCoverImage(payload.imageUrl, gallery);

    const fullPayload = {
      product_id: productId,
      display_name: payload.name.trim(),
      display_description: payload.description.trim(),
      display_price: Number(payload.price),
      brand_public: brandPublic,
      image_url: coverImage,
      image_urls: gallery,
      colors,
      updated_at: now
    };

    const { error } = await supabase.from('product_web').upsert(
      fullPayload,
      { onConflict: 'product_id' }
    );

    if (error && this.isMissingColumn(error.message, 'colors')) {
      const { error: fallbackError } = await supabase.from('product_web').upsert(
        {
          product_id: productId,
          display_name: payload.name.trim(),
          display_description: payload.description.trim(),
          display_price: Number(payload.price),
          brand_public: brandPublic,
          image_url: coverImage,
          image_urls: gallery,
          updated_at: now
        },
        { onConflict: 'product_id' }
      );
      if (fallbackError) throw new Error(fallbackError.message);
      return;
    }

    if (error) {
      throw new Error(error.message);
    }
  }

  private async getProductWebOnce(id: string): Promise<{ data: unknown; error: { message: string } | null }> {
    const fullQuery = await supabase
      .from('product_web')
      .select('brand_public, image_url, image_urls, colors')
      .eq('product_id', id)
      .maybeSingle();

    if (!fullQuery.error || !this.isMissingColumn(fullQuery.error.message, 'colors')) {
      return { data: fullQuery.data, error: fullQuery.error ? { message: fullQuery.error.message } : null };
    }

    const fallbackQuery = await supabase
      .from('product_web')
      .select('brand_public, image_url, image_urls')
      .eq('product_id', id)
      .maybeSingle();

    return {
      data: fallbackQuery.data,
      error: fallbackQuery.error ? { message: fallbackQuery.error.message } : null
    };
  }

  private isMissingColumn(message: string, columnName: string): boolean {
    const normalized = message.toLowerCase();
    const hasColumnName = normalized.includes(columnName.toLowerCase());
    const isMissingColumnError =
      normalized.includes('does not exist') ||
      normalized.includes('schema cache') ||
      normalized.includes('could not find');
    return hasColumnName && isMissingColumnError;
  }

  private mapProduct(row: Record<string, unknown>, webRow: Record<string, unknown> | null = null): Product {
    return {
      id: String(row['id'] ?? ''),
      sku: String(row['sku'] ?? ''),
      name: String(row['name'] ?? ''),
      category: String(row['category'] ?? ''),
      description: String(row['description'] ?? ''),
      price: Number(row['price'] ?? 0),
      cost: row['cost'] == null ? undefined : Number(row['cost'] ?? 0),
      barcode: row['barcode'] == null ? undefined : String(row['barcode'] ?? ''),
      brand: row['brand'] == null ? undefined : String(row['brand'] ?? ''),
      brandPublic: webRow?.['brand_public'] == null ? undefined : String(webRow['brand_public'] ?? ''),
      unit: row['unit'] == null ? undefined : String(row['unit'] ?? ''),
      location: row['location'] == null ? undefined : String(row['location'] ?? ''),
      imageUrl: webRow?.['image_url'] == null ? undefined : String(webRow['image_url'] ?? ''),
      imageUrls: toStringArray(webRow?.['image_urls']),
      colors: toStringArray(webRow?.['colors']),
      supplierId: row['supplier_id'] == null ? null : String(row['supplier_id'] ?? ''),
      leadTimeDays: row['lead_time_days'] == null ? undefined : Number(row['lead_time_days'] ?? 0),
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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function normalizeStringArray(value: string[]): string[] {
  return value.map((item) => item.trim()).filter(Boolean);
}

function pickCoverImage(imageUrl: string | undefined, gallery: string[]): string | null {
  const cover = imageUrl?.trim() ?? '';
  if (isLikelyImageUrl(cover)) {
    return cover;
  }

  const galleryCover = gallery.find((url) => isLikelyImageUrl(url));
  return galleryCover ?? null;
}

function isLikelyImageUrl(value: string): boolean {
  if (!value) return false;
  return /^https?:\/\/.+\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(value);
}

function sanitizePathSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'draft';
}

function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  const ext = parts.length > 1 ? parts.pop() : null;
  if (!ext) return 'jpg';
  return ext.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
}
