import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Campaign Pulse",
  description: "Send with confidence. Understand every outcome.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans"><AppShell>{children}</AppShell></body>
    </html>
  );
}
