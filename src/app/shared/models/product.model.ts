export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  price: number;
  cost?: number;
  barcode?: string;
  brand?: string;
  unit?: string;
  location?: string;
  supplierId?: string | null;
  leadTimeDays?: number;
  minStock: number;
  active: boolean;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface ProductPayload {
  sku: string;
  name: string;
  category: string;
  description: string;
  price: number;
  cost?: number;
  barcode?: string;
  brand?: string;
  unit?: string;
  location?: string;
  supplierId?: string | null;
  leadTimeDays?: number;
  minStock: number;
  active: boolean;
}
