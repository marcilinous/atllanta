import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Same family and weights the legacy shell loads from Google Fonts
// (public/index.html), self-hosted by next/font.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Atllanta",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
