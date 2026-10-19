import type { Unit } from "./veg";

/** A saved vegetable bill as read back from the database. */
export interface SavedBillItem {
  name: string;
  qty: number;
  qty_unit: Unit;
  rate: number;
  rate_qty: number;
  rate_unit: Unit;
  price: number;
}

export interface SavedBill {
  id: string;
  bought_on: string;
  vendor: string | null;
  total: number;
  vendor_asked: number | null;
  veg_items: SavedBillItem[];
}

/** Past bills ask the calculator to open one for editing with this window event. */
export const EDIT_BILL_EVENT = "veg-edit-bill";
/** The calculator announces saves so the history list refreshes. */
export const BILL_SAVED_EVENT = "veg-bill-saved";
