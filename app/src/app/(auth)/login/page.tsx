// SPDX-License-Identifier: FSL-1.1-ALv2
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, hasUsers } from "@/lib/auth/session";
import { safeNext } from "@/lib/forms";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!(await hasUsers())) redirect("/setup");
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  if (await getSession()) redirect(next);
  return <LoginForm next={next} />;
}
