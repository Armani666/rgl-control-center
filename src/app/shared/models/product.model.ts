export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  price: number;
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
  minStock: number;
  active: boolean;
}
