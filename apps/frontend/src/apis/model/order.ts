export interface OrderContext {
  orderId: string;
  placedAt: string; // display string, e.g. "Placed Oct 24, 2023"
  statusText: string; // e.g. "In Transit"
  currentLocation: string; // e.g. "Beijing Hub (ZBAA)"
  itemsCount: number;
  itemsSummary: string; // e.g. "Edge Tensor Unit, 4m Cable"
  velocity: number[]; // shipment-velocity bars, values 0..1
}
