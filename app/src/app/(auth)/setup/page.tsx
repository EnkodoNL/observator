// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasUsers } from "@/lib/auth/session";
import { announceSetupCode, setupCodeRequired } from "@/lib/auth/setup-code";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage() {
  if (await hasUsers()) redirect("/login");
  // Printed again on every visit, in case the startup log has scrolled away.
  await announceSetupCode();
  return <SetupForm codeRequired={setupCodeRequired()} />;
}
