export interface PurchaseSuggestion {
  productId: string;
  productName: string;
  sku: string;
  category: string;
  currentStock: number;
  minStock: number;
  recommendedQty: number;
  reorderPoint: number;
  safetyStock: number;
  averageDailyOut: number;
  daysOfCoverage: number | null;
  supplierId: string | null;
  supplierName: string | null;
  leadTimeDays: number;
  estimatedUnitCost: number | null;
  estimatedTotalCost: number | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
}
