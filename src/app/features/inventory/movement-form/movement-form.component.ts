import { AsyncPipe, CommonModule, DatePipe } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest, map, switchMap } from 'rxjs';

import { InventoryService } from '../../../core/services/inventory.service';
import { ProductService } from '../../../core/services/product.service';
import { MovementType } from '../../../shared/models/inventory-movement.model';

@Component({
  selector: 'app-movement-form',
  imports: [AsyncPipe, CommonModule, DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './movement-form.component.html',
  styleUrl: './movement-form.component.scss'
})
export class MovementFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly inventoryService = inject(InventoryService);
  private readonly productService = inject(ProductService);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = this.fb.nonNullable.group({
    type: ['IN' as MovementType, Validators.required],
    quantity: [1, [Validators.required, Validators.min(1)]],
    reason: ['', [Validators.required, Validators.maxLength(80)]],
    note: ['', [Validators.maxLength(300)]]
  });

  productId = '';
  saving = false;
  errorMessage = '';
  successMessage = '';

  readonly productId$ = this.route.paramMap.pipe(
    map((params) => {
      const id = params.get('productId') ?? '';
      this.productId = id;
      return id;
    })
  );

  readonly vm$ = this.productId$.pipe(
    switchMap((productId) =>
      combineLatest({
        product: this.productService.getProduct$(productId),
        stock: this.inventoryService.getStockByProduct$(productId),
        movements: this.inventoryService.getMovementsByProduct$(productId)
      })
    )
  );

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.errorMessage = '';
      this.successMessage = '';
    });
  }

  async submit(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    this.form.markAllAsTouched();

    if (this.form.invalid || !this.productId) {
      return;
    }

    this.saving = true;
    try {
      const raw = this.form.getRawValue();
      await this.inventoryService.createMovement({
        productId: this.productId,
        type: raw.type,
        quantity: raw.quantity,
        reason: raw.reason,
        note: raw.note
      });
      this.successMessage = 'Movimiento registrado correctamente.';
      this.form.patchValue({
        type: raw.type,
        quantity: 1,
        reason: '',
        note: ''
      });
      this.form.markAsPristine();
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

  return 'No se pudo registrar el movimiento.';
}
