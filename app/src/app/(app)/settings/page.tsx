// SPDX-License-Identifier: FSL-1.1-ALv2
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

export default async function SettingsIndex() {
  await requireUser();
  redirect("/settings/general");
}
