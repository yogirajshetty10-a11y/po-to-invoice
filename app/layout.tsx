import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PO → Invoice",
  description: "Upload a purchase order PDF and turn it into an invoice",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
