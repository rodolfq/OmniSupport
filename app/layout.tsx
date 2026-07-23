import React, { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "./app-context";
import { ThemeProvider } from "./theme-provider";
import { PwaRegister } from "@/components/pwa-register";

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
  title: "SSX Resolve - Redefinindo o Atendimento",
  description: "Plataforma avançada de suporte ao cliente com IA",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.png", sizes: "512x512", type: "image/png" }
    ],
    apple: "/apple-touch-icon.png"
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SSX Resolve"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0D3A69"
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
            </Suspense>
            {/* toastOptions.classNames.default: as notificações de evento
                (chat_message, ticket_new etc., disparadas por addNotification
                em app-context.tsx) nunca passam `type` pro toast() — sem
                isso, o Sonner renderiza um toast neutro branco/preto (sem
                relação com a marca), diferente das confirmações de ação
                (toast.success/error, que continuam com as cores semânticas
                do Sonner via `richColors`, sem serem afetadas por este
                override). Damos a esse toast neutro a mesma linguagem visual
                do resto do site (cor de destaque, cartão, bordas). */}
            <Toaster
              position="top-right"
              richColors
              toastOptions={{
                classNames: {
                  default: '!bg-[var(--surface-card)] !border !border-[var(--accent)]/30 !rounded-2xl !shadow-xl',
                  title: '!text-[var(--text-primary)] !font-black',
                  description: '!text-[var(--text-tertiary)] !font-medium',
                  icon: '!text-[var(--accent-text)]'
                }
              }}
            />
            <PwaRegister />
          </AppProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
