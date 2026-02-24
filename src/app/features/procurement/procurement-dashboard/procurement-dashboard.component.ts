import { AsyncPipe, CurrencyPipe, DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { combineLatest, map } from 'rxjs';

import { ProcurementService } from '../../../core/services/procurement.service';
import { ProductService } from '../../../core/services/product.service';
import { SupplierService } from '../../../core/services/supplier.service';

@Component({
  selector: 'app-procurement-dashboard',
  imports: [AsyncPipe, CurrencyPipe, DecimalPipe, NgClass, NgFor, NgIf, ReactiveFormsModule],
  templateUrl: './procurement-dashboard.component.html',
  styleUrl: './procurement-dashboard.component.scss'
})
export class ProcurementDashboardComponent {
  private readonly fb = inject(FormBuilder);
  private readonly supplierService = inject(SupplierService);
  private readonly procurementService = inject(ProcurementService);
  private readonly productService = inject(ProductService);

  readonly supplierForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    contactName: ['', [Validators.maxLength(120)]],
    email: ['', [Validators.maxLength(120)]],
    phone: ['', [Validators.maxLength(40)]],
    leadTimeDays: [7, [Validators.required, Validators.min(0)]],
    active: [true],
    notes: ['', [Validators.maxLength(500)]]
  });

  readonly linkForm = this.fb.nonNullable.group({
    productId: ['', Validators.required],
    supplierId: ['', Validators.required],
    supplierSku: ['', [Validators.maxLength(80)]],
    cost: [0, [Validators.required, Validators.min(0)]],
    minOrderQty: [1, [Validators.required, Validators.min(1)]],
    preferred: [true]
  });

  savingSupplier = false;
  savingLink = false;
  errorMessage = '';
  successMessage = '';

  readonly vm$ = combineLatest([
    this.procurementService.suggestions$,
    this.supplierService.getSuppliers$(),
    this.supplierService.getProductSupplierLinks$(),
    this.productService.getProducts$()
  ]).pipe(
    map(([suggestions, suppliers, links, products]) => {
      const activeSuppliers = suppliers.filter((item) => item.active);
      const critical = suggestions.filter((item) => item.priority === 'critical');
      const high = suggestions.filter((item) => item.priority === 'high');
      const estimatedBuyBudget = suggestions.reduce(
        (sum, item) => sum + (item.estimatedTotalCost ?? 0),
        0
      );

      const linkedProducts = new Set(links.map((item) => item.productId)).size;

      return {
        suggestions: suggestions.slice(0, 50),
        suppliers,
        activeSuppliers,
        products: products.filter((product) => product.active),
        links,
        summary: {
          suggestions: suggestions.length,
          critical: critical.length,
          high: high.length,
          suppliers: suppliers.length,
          linkedProducts,
          estimatedBuyBudget
        }
      };
    })
  );

  async submitSupplier(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    this.supplierForm.markAllAsTouched();
    if (this.supplierForm.invalid) return;

    this.savingSupplier = true;
    try {
      await this.supplierService.saveSupplier(this.supplierForm.getRawValue());
      this.successMessage = 'Proveedor guardado.';
      this.supplierForm.patchValue({
        name: '',
        contactName: '',
        email: '',
        phone: '',
        leadTimeDays: 7,
        active: true,
        notes: ''
      });
      this.supplierForm.markAsPristine();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo guardar proveedor.';
    } finally {
      this.savingSupplier = false;
    }
  }

  async submitProductSupplierLink(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';
    this.linkForm.markAllAsTouched();
    if (this.linkForm.invalid) return;

    this.savingLink = true;
    try {
      await this.supplierService.saveProductSupplierLink(this.linkForm.getRawValue());
      this.successMessage = 'Relacion producto-proveedor guardada.';
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'No se pudo guardar la relacion.';
    } finally {
      this.savingLink = false;
    }
  }
}
