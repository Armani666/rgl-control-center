import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
    sku: ['', [Validators.required, Validators.maxLength(40)]],
    name: ['', [Validators.required, Validators.maxLength(120)]],
    category: ['', [Validators.maxLength(60)]],
    price: [0, [Validators.required, Validators.min(0)]],
    minStock: [0, [Validators.required, Validators.min(0)]],
    description: ['', [Validators.maxLength(500)]],
    active: [true]
  });

  productId: string | null = null;
  isEditMode = false;
  loading = false;
  saving = false;
  errorMessage = '';

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(async (params) => {
      const id = params.get('id');
      if (!id) {
        this.isEditMode = false;
        this.productId = null;
        return;
      }

      this.loading = true;
      this.errorMessage = '';
      this.productId = id;
      this.isEditMode = true;

      try {
        const product = await this.productService.getProductOnce(id);
        if (!product) {
          this.errorMessage = 'No se encontró el producto.';
          return;
        }

        this.form.patchValue({
          sku: product.sku,
          name: product.name,
          category: product.category,
          price: product.price,
          minStock: product.minStock,
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
      const payload = this.form.getRawValue() satisfies ProductPayload;
      await this.productService.saveProduct(payload, this.productId ?? undefined);
      await this.router.navigate(['/products']);
    } catch (error) {
      this.errorMessage = extractErrorMessage(error);
    } finally {
      this.saving = false;
    }
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Ocurrió un error inesperado.';
}
