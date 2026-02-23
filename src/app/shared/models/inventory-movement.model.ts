export type MovementType = 'IN' | 'OUT';

export interface InventoryMovement {
  id: string;
  productId: string;
  type: MovementType;
  quantity: number;
  reason: string;
  note: string;
  createdAt?: Date | null;
}

export interface CreateInventoryMovementInput {
  productId: string;
  type: MovementType;
  quantity: number;
  reason: string;
  note: string;
}
