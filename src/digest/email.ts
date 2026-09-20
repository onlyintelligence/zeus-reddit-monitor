import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";
let t: Transporter | undefined;
export function mailer() {
  const e = env();
  const { user, pass } = requireDigestConfig();
  return (t ??= nodemailer.createTransport({ host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_PORT === 465, auth: { user, pass } }));
}
export async function sendMail(subject: string, html: string, text: string) {
  const { to, from } = requireDigestConfig();
  await mailer().sendMail({ from, to, subject, html, text });
}

/**
 * The digest credentials are optional at boot so that `job:listen` — which
 * reads public RSS and writes nothing — runs on a machine with no SMTP account.
 * They are required HERE, at the moment of sending, mirroring the token check in
 * triage/claude.ts. Missing config is a loud failure, never a silent no-send.
 */
export function requireDigestConfig() {
  const e = env();
  const missing = (["DIGEST_TO", "DIGEST_FROM", "SMTP_USER", "SMTP_PASS"] as const).filter((k) => !e[k]);
  if (missing.length) throw new Error(`cannot send the digest: ${missing.join(", ")} not set in .env`);
  return { to: e.DIGEST_TO!, from: e.DIGEST_FROM!, user: e.SMTP_USER!, pass: e.SMTP_PASS! };
}
