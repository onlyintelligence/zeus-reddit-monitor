import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env.js";
let t: Transporter | undefined;
export function mailer() {
  const e = env();
  return (t ??= nodemailer.createTransport({ host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_PORT === 465, auth: { user: e.SMTP_USER, pass: e.SMTP_PASS } }));
}
export async function sendMail(subject: string, html: string, text: string) {
  const e = env();
  await mailer().sendMail({ from: e.DIGEST_FROM, to: e.DIGEST_TO, subject, html, text });
}
