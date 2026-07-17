import React, { Suspense } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "./app-context";
import { ThemeProvider } from "./theme-provider";
import { ChatWidget } from "@/components/chat-widget";

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('omni_theme');
    var isDark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    }
  } catch (e) {}
})();
`;

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
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; object-src 'none';"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <ThemeProvider>
          <AppProvider>
            <Suspense fallback={null}>
              {children}
              <ChatWidget />
            </Suspense>
            <Toaster position="top-right" richColors />
          </AppProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
