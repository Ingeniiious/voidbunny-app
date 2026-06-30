import { Providers } from "@/components/providers";
import { SkipToContent } from "@/components/skip-to-content";
import { baseMetadata, structuredData } from "@/lib/metadata";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = baseMetadata;

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData),
          }}
        />
      </head>
      <body
        className="min-h-screen bg-background font-sans text-foreground antialiased"
      >
        <Providers>
          <SkipToContent />
          <div className="mx-auto flex min-h-screen w-[calc(100%-1.5rem)] max-w-[1440px] flex-col border-x border-border sm:w-[calc(100%-2.5rem)] lg:w-[calc(100%-3rem)]">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
