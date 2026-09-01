import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Schedule — FIRS WHT & VAT preparation",
  description:
    "Drop in bank statements and invoices. Get a FIRS-format withholding tax and VAT schedule you can review, correct, and file.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
