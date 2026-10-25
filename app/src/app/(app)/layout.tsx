// SPDX-License-Identifier: FSL-1.1-ALv2
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { CommandPalette } from "@/components/command-palette";
import { listProjects } from "@/lib/data/projects";
import { requireUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const projects = await listProjects();
  return (
    <>
      <AppHeader
        email={session.user.email}
        actions={<CommandPalette projects={projects.map((p) => ({ name: p.name, slug: p.slug }))} />}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <AppFooter sourceUrl={env().SOURCE_URL} />
    </>
  );
}
