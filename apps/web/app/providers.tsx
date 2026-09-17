"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15 * 1000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--white)",
            color: "var(--ink-900)",
            border: "1px solid var(--ink-200)",
          },
        }}
      />
    </QueryClientProvider>
  );
}
