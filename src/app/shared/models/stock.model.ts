export interface StockRecord {
  productId: string;
  quantity: number;
  minStock: number;
  updatedAt?: Date | null;
}

export interface StockOverview extends StockRecord {
  productName: string;
  sku: string;
  category: string;
  isLowStock: boolean;
}
