export interface SalesRecord {
  id: string;
  sellerProfileId: string;
  sellerName: string;
  sellerEmail: string;
  customerName: string;
  customerPhone: string;
  productId: string | null;
  productName: string;
  quantity: number;
  totalAmount: number;
  commissionRate: number;
  commissionAmount: number;
  saleDate: Date | null;
  note: string;
  createdAt: Date | null;
}

export interface SalesRecordPayload {
  sellerProfileId: string;
  customerName?: string;
  customerPhone?: string;
  productId?: string | null;
  productName: string;
  quantity: number;
  totalAmount: number;
  commissionRate: number;
  saleDate: string; // YYYY-MM-DD
  note: string;
}

export interface CommissionPayment {
  id: string;
  sellerProfileId: string;
  amount: number;
  paymentDate: Date | null;
  note: string;
  createdAt: Date | null;
}

export interface CommissionPaymentPayload {
  sellerProfileId: string;
  amount: number;
  paymentDate: string; // YYYY-MM-DD
  note: string;
}
