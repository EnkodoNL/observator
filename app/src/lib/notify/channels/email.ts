// SPDX-License-Identifier: FSL-1.1-ALv2
import nodemailer, { type Transporter } from "nodemailer";
import { z } from "zod";
import { env, smtpConfigured } from "@/lib/env";
import { escapeHtml, TONE_COLOR, toPlainText, type Message } from "../message";
import { SendError, type ChannelDriver } from "./types";

function html(msg: Message): string {
  const items = msg.items
    .map(
      (i) =>
        `<li style="margin:0 0 6px">${i.severity ? `<strong style="color:${TONE_COLOR[i.severity]}">${i.severity.toUpperCase()}</strong> ` : ""}${
          i.url
            ? `<a href="${escapeHtml(i.url)}" style="color:#111">${escapeHtml(i.title)}</a>`
            : `<strong>${escapeHtml(i.title)}</strong>`
        }${i.detail ? ` <span style="color:#555">${escapeHtml(i.detail)}</span>` : ""}</li>`,
    )
    .join("");
  const actions = msg.actions
    .map(
      (a, n) =>
        `<a href="${escapeHtml(a.url)}" style="display:inline-block;margin-right:8px;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:600;${
          n === 0 ? "background:#111;color:#fff" : "border:1px solid #ccc;color:#111"
        }">${escapeHtml(a.label)}</a>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f7;font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#111">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:24px;border-top:4px solid ${TONE_COLOR[msg.tone]}">
<h1 style="font-size:17px;margin:0 0 8px">${escapeHtml(msg.title)}</h1>
<p style="margin:0 0 16px;color:#333">${escapeHtml(msg.summary)}</p>
${items ? `<ul style="padding-left:18px;margin:0 0 16px">${items}${msg.more ? `<li>…and ${msg.more} more</li>` : ""}</ul>` : ""}
${actions ? `<p style="margin:16px 0 0">${actions}</p>` : ""}
</div><p style="max-width:600px;margin:12px auto 0;color:#888;font-size:12px">Sent by Observator.</p></body></html>`;
}

let transport: Transporter | null = null;
function getTransport(): Transporter {
  if (!smtpConfigured()) throw new SendError("SMTP is not configured: set SMTP_HOST and SMTP_FROM");
  const e = env();
  transport ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transport;
}

const recipients = z
  .string()
  .transform((s) => s.split(/[\s,;]+/).filter(Boolean))
  .pipe(z.array(z.email("Invalid e-mail address")).min(1, "At least one recipient"));

export const email: ChannelDriver<{ to: string }> = {
  type: "email",
  label: "E-mail",
  description: "Through the SMTP server configured in the environment.",
  help: ["SMTP settings come from SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM."],
  fields: [{ name: "to", label: "Recipients", kind: "text", placeholder: "you@example.com", required: true }],
  schema: z.object({
    to: z.string().refine((s) => recipients.safeParse(s).success, "Comma separated e-mail addresses"),
  }),
  async send(msg, { to }) {
    try {
      await getTransport().sendMail({
        from: env().SMTP_FROM,
        to: recipients.parse(to),
        subject: msg.title,
        text: toPlainText(msg),
        html: html(msg),
      });
    } catch (err) {
      if (err instanceof SendError) throw err;
      throw new SendError(`SMTP: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
