// SPDX-License-Identifier: FSL-1.1-ALv2
import "server-only";
import { z } from "zod";
import { DEFAULT_REPORTER_IMAGE, reporterImage } from "@/lib/snippet";

const bool = z
  .enum(["on", "off", "true", "false", "1", "0"])
  .transform((v) => v === "on" || v === "true" || v === "1");

const schema = z.object({
  APP_URL: z.url().transform((v) => v.replace(/\/+$/, "")),
  PB_URL: z.url().default("http://127.0.0.1:8090"),
  PB_SUPERUSER_EMAIL: z.email(),
  PB_SUPERUSER_PASSWORD: z
    .string()
    .min(10)
    .refine((v) => v !== "change-me-to-something-long", "still the example value from .env.example"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: bool.default(false),
  OBSERVATOR_JOBS: bool.default(true),
  INGEST_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  INGEST_RATE_LIMIT: z.coerce.number().int().positive().default(60),
  /**
   * Reverse proxies in front of Observator that each add an X-Forwarded-For entry (Coolify's
   * Traefik is one). Cloudflare does not count: it is recognised by its address.
   */
  TRUSTED_PROXIES: z.coerce.number().int().min(1).max(10).default(1),
  /** Cloudflare sits in front: take the visitor from CF-Connecting-IP when the hop is Cloudflare. */
  TRUST_CLOUDFLARE: bool.default(false),
  SOURCE_URL: z.url().default("https://github.com/EnkodoNL/observator"),
  TZ: z.string().default("UTC"),
  /** Where the snippet copies the reporter from; a mirror or fork can point elsewhere. */
  REPORTER_IMAGE: z.string().trim().default(DEFAULT_REPORTER_IMAGE).transform(reporterImage),
  /**
   * The first account needs the setup code from the log. Off: whoever reaches /setup first
   * creates it, for installs that are not reachable from outside until they are set up.
   */
  SETUP_CODE: bool.default(true),
  /** Report Observator's own Node version and packages at startup, as the "Observator" project. */
  OBSERVATOR_SELF: bool.default(true),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Parsed lazily so `next build` works without runtime env. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(
    Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v])),
  );
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function smtpConfigured(): boolean {
  const e = env();
  return Boolean(e.SMTP_HOST && e.SMTP_FROM);
}

export function secureCookies(): boolean {
  return env().APP_URL.startsWith("https://");
}
