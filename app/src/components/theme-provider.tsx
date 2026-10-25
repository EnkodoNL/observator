// SPDX-License-Identifier: FSL-1.1-ALv2
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider(props: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
