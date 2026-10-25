// SPDX-License-Identifier: FSL-1.1-ALv2
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo className="text-lg" />
        </div>
        {children}
      </div>
    </main>
  );
}
