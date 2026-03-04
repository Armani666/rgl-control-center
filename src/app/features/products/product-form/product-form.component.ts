import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ProductService } from '../../../core/services/product.service';
import { ProductPayload } from '../../../shared/models/product.model';

@Component({
  selector: 'app-product-form',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './product-form.component.html',
  styleUrl: './product-form.component.scss'
})
export class ProductFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly productService = inject(ProductService);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = this.fb.nonNullable.group({
    sku: ['', [Validators.maxLength(40)]],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    category: ['', [Validators.maxLength(60)]],
    brand: ['', [Validators.maxLength(120)]],
    brandPublic: ['', [Validators.maxLength(120)]],
    colorsInput: ['', [Validators.maxLength(300)]],
    price: [0, [Validators.required, Validators.min(0)]],
    minStock: [0, [Validators.required, Validators.min(0)]],
    imageUrl: ['', [Validators.maxLength(500)]],
    imageUrlsInput: ['', [Validators.maxLength(3000)]],
    description: ['', [Validators.maxLength(500)]],
    active: [true]
  });

  productId: string | null = null;
  isEditMode = false;
  loading = false;
  saving = false;
  uploadingCover = false;
  uploadingGallery = false;
  errorMessage = '';

  constructor() {
    this.form.controls.brand.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.refreshSkuPreview();
    });
    this.form.controls.brandPublic.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.refreshSkuPreview();
    });

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(async (params) => {
      const id = params.get('id');
      if (!id) {
        this.isEditMode = false;
        this.productId = null;
        this.refreshSkuPreview();
        return;
      }

      this.loading = true;
      this.errorMessage = '';
      this.productId = id;
      this.isEditMode = true;

      try {
        const product = await this.productService.getProductOnce(id);
        if (!product) {
          this.errorMessage = 'No se encontro el producto.';
          return;
        }

        this.form.patchValue({
          sku: product.sku,
          name: product.name,
          category: product.category,
          brand: product.brand ?? '',
          brandPublic: product.brandPublic ?? product.brand ?? '',
          colorsInput: (product.colors ?? []).join(', '),
          price: product.price,
          minStock: product.minStock,
          imageUrl: product.imageUrl ?? '',
          imageUrlsInput: (product.imageUrls ?? []).join('\n'),
          description: product.description,
          active: product.active
        });
      } catch (error) {
        this.errorMessage = extractErrorMessage(error);
      } finally {
        this.loading = false;
      }
    });
  }

  async submit(): Promise<void> {
    this.errorMessage = '';
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      return;
    }

    this.saving = true;

    try {
      const form = this.form.getRawValue();
      const payload: ProductPayload = {
        sku: form.sku,
        name: form.name,
        category: form.category,
        description: form.description,
        price: form.price,
        brand: form.brand,
        brandPublic: form.brandPublic || form.brand,
        colors: splitValues(form.colorsInput),
        imageUrl: form.imageUrl,
        imageUrls: splitValues(form.imageUrlsInput),
        minStock: form.minStock,
        active: form.active
      };

      await this.productService.saveProduct(payload, this.productId ?? undefined);
      await this.router.navigate(['/products']);
    } catch (error) {
      this.errorMessage = extractErrorMessage(error);
    } finally {
      this.saving = false;
    }
  }

  get coverPreviewUrl(): string | null {
    const cover = this.form.controls.imageUrl.value.trim();
    return isImageUrl(cover) ? cover : null;
  }

  get galleryPreviewUrls(): string[] {
    return splitValues(this.form.controls.imageUrlsInput.value).filter((url) => isImageUrl(url));
  }

  async uploadCoverFromFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.uploadingCover = true;
    this.errorMessage = '';
    try {
      const url = await this.productService.uploadProductImage(file, this.getProductRef(), 'cover');
      this.form.patchValue({ imageUrl: url });
    } catch (error) {
      this.errorMessage = extractErrorMessage(error);
    } finally {
      this.uploadingCover = false;
      input.value = '';
    }
  }

  async uploadGalleryFromFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;

    this.uploadingGallery = true;
    this.errorMessage = '';
    try {
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const url = await this.productService.uploadProductImage(file, this.getProductRef(), 'gallery');
        uploadedUrls.push(url);
      }

      const currentUrls = splitValues(this.form.controls.imageUrlsInput.value);
      const merged = uniqueStrings([...currentUrls, ...uploadedUrls]);
      this.form.patchValue({ imageUrlsInput: merged.join('\n') });
    } catch (error) {
      this.errorMessage = extractErrorMessage(error);
    } finally {
      this.uploadingGallery = false;
      input.value = '';
    }
  }

  private getProductRef(): string {
    const sku = this.form.controls.sku.value;
    return this.productId ?? sku ?? 'draft';
  }

  private refreshSkuPreview(): void {
    if (this.isEditMode) {
      return;
    }
    const brandCandidate = this.form.controls.brand.value || this.form.controls.brandPublic.value;
    this.form.controls.sku.setValue(buildSkuPreview(brandCandidate), { emitEvent: false });
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Ocurrio un error inesperado.';
}

function splitValues(raw: string): string[] {
  return raw
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function buildSkuPreview(brand: string): string {
  const code = toBrandCode(brand);
  return `RGL-${code}01`;
}

function toBrandCode(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (!normalized) {
    return 'GEN';
  }

  return normalized.slice(0, 3).padEnd(3, 'X');
}

function isImageUrl(value: string): boolean {
  if (!value) return false;
  return /^https?:\/\/.+\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(value);
}
