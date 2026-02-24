export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  leadTimeDays: number;
  active: boolean;
  notes: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface SupplierPayload {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  leadTimeDays: number;
  active: boolean;
  notes: string;
}

export interface ProductSupplierLink {
  productId: string;
  supplierId: string;
  supplierSku: string;
  cost: number;
  minOrderQty: number;
  preferred: boolean;
  updatedAt?: Date | null;
}
