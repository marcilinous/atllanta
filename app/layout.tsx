import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read server-side so the correct theme paints on the first
  // server-rendered frame — the legacy app (public/index.html) writes this
  // same cookie, so a user's choice there carries over here too.
  const cookieStore = await cookies();
  const theme = cookieStore.get("atllanta-theme")?.value;
  const themeProps = theme === "dark" || theme === "light" ? { "data-theme": theme } : {};

  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} {...themeProps}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
