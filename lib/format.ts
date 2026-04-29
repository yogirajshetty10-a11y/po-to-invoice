const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? " " + ONES[o] : "");
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let out = "";
  if (h) out = ONES[h] + " Hundred";
  if (r) out += (out ? " " : "") + twoDigits(r);
  return out;
}

function indianWords(n: number): string {
  if (n === 0) return "Zero";
  let out = "";
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) out += twoDigits(crore) + " Crore ";
  if (lakh) out += twoDigits(lakh) + " Lakh ";
  if (thousand) out += twoDigits(thousand) + " Thousand ";
  if (n) out += threeDigits(n);
  return out.trim();
}

export function rupeesInWords(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);
  let out = "INR " + indianWords(rupees);
  if (paise) out += " and " + indianWords(paise) + " paise";
  return out + " Only";
}

export function taxAmountInWords(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);
  let out = "INR " + indianWords(rupees);
  if (paise) out += " and " + indianWords(paise) + " paise";
  return out + " Only";
}

export function inr(n: number, decimals = 2): string {
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe);
}
