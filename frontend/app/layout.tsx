import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tokenized Stocks",
  description: "LightPool spot-exchange sample",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
