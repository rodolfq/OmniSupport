import React, { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "./app-context";
import { ChatWidget } from "@/components/chat-widget";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OmniSupport - Redefinindo o Atendimento",
  description: "Plataforma avançada de suporte ao cliente com IA",
  icons: {
    icon: "/favicon.svg",
  }
};

import { Toaster } from "sonner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <meta 
          httpEquiv="Content-Security-Policy" 
          content="script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; object-src 'none';" 
        />
      </head>
      <body className={inter.className}>
        <AppProvider>
          <Suspense fallback={null}>
            {children}
            <ChatWidget />
          </Suspense>
          <Toaster position="top-right" richColors />
        </AppProvider>
      </body>
    </html>
  );
}
