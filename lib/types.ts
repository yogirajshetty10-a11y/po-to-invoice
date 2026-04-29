export type Party = {
  name: string;
  address: string;
  gstin?: string;
  pan?: string;
  stateName?: string;
  stateCode?: string;
  email?: string;
  phone?: string;
};

export type LineItem = {
  itemCode?: string;
  description: string;
  hsnCode?: string;
  quantity: number;
  unit?: string;
  rate: number;
  amount: number;
  taxRate?: number;
};

export type ExtractedPO = {
  poNumber: string;
  poDate: string;
  deliveryDate: string;
  paymentTerms: string;
  reference: string;
  referenceDate: string;
  currency: string;
  vendor: Party;
  buyer: Party;
  shipTo: Party;
  items: LineItem[];
  taxableValue: number;
  igstRate: number;
  cgstRate: number;
  sgstRate: number;
  cessRate: number;
  igstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  cessAmount: number;
  roundOff: number;
  total: number;
  notes: string;
};

export type Invoice = ExtractedPO & {
  invoiceNumber: string;
  invoiceDate: string;
  buyersOrderNo: string;
  buyersOrderDate: string;
  dispatchDocNo: string;
  dispatchedThrough: string;
  destination: string;
  termsOfDelivery: string;
  modeOfPayment: string;
  deliveryNoteNo: string;
  deliveryNoteDate: string;
  otherReferences: string;
};
