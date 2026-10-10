import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Semain · Calidad",
  description: "Control de calidad y seguimiento de PV y envíos de Semain",
  keywords: ["Semain", "calidad", "PV", "envíos", "seguimiento", "control de calidad"],
  authors: [{ name: "Semain" }],
  manifest: "/manifest.json",
  applicationName: "Semain Calidad",
  appleWebApp: {
    capable: true,
    title: "Semain Calidad",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/icon-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/icon-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
    ],
    shortcut: ["/favicon.ico"],
  },
  openGraph: {
    title: "Semain · Calidad",
    description: "Control de calidad y seguimiento de PV y envíos",
    siteName: "Semain Calidad",
    type: "website",
    locale: "es_MX",
  },
  twitter: {
    card: "summary",
    title: "Semain · Calidad",
    description: "Control de calidad y seguimiento de PV y envíos",
  },
};

export const viewport: Viewport = {
  themeColor: "#8DC63F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Semain Calidad" />
        <meta name="application-name" content="Semain Calidad" />
        <meta name="msapplication-TileColor" content="#8DC63F" />
        <meta name="msapplication-tap-highlight" content="no" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
