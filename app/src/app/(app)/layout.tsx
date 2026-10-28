// SPDX-License-Identifier: FSL-1.1-ALv2
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { CommandPalette } from "@/components/command-palette";
import { DemoBanner } from "@/components/demo-banner";
import { Suspense } from "react";
import { SnippetFormProvider } from "@/components/snippet-form";
import { listProjects } from "@/lib/data/projects";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const projects = await listProjects();
  return (
    <SnippetFormProvider image={env().REPORTER_IMAGE}>
      <AppHeader
        email={session.user.email}
        demo={session.readOnly}
        actions={<CommandPalette projects={projects.map((p) => ({ name: p.name, slug: p.slug }))} />}
      />
      {session.readOnly && (
        <Suspense>
          <DemoBanner />
        </Suspense>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <AppFooter sourceUrl={env().SOURCE_URL} />
    </SnippetFormProvider>
  );
}
