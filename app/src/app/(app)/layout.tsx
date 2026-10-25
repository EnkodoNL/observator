// SPDX-License-Identifier: FSL-1.1-ALv2
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  return (
    <>
      <AppHeader email={session.user.email} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <AppFooter sourceUrl={env().SOURCE_URL} />
    </>
  );
}
