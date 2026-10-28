// SPDX-License-Identifier: FSL-1.1-ALv2
import { SettingsNav } from "@/components/settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-10">
      <aside className="md:w-44 md:shrink-0">
        <h1 className="mb-4 font-display text-3xl font-bold tracking-tight">Settings</h1>
        <SettingsNav />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
