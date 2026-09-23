import type { Metadata, Viewport } from "next";

import { ServiceWorkerRegistration } from "@/components/navigation/ServiceWorkerRegistration";

import "./globals.css";

export const metadata: Metadata = {
  title: "Wispex Work Copilot",
  description: "Personal work planning and decision-support assistant for data prep work.",
  applicationName: "Wispex",
  appleWebApp: { capable: true, title: "Wispex", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#166666",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
