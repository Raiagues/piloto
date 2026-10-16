import nodemailer from 'nodemailer';

/** No console transport: verification and invitation tokens never enter logs. */
export function createMailer(env = process.env) {
  const configured = Boolean(env.SMTP_HOST && env.SMTP_FROM && env.NORTE_PUBLIC_URL);
  if (!configured) return { configured: false };
  const publicUrl = new URL(env.NORTE_PUBLIC_URL);
  if (!['https:', 'http:'].includes(publicUrl.protocol) || (env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:')) throw new Error('NORTE_PUBLIC_URL must use HTTPS in production.');
  const port = Number(env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    logger: false, debug: false, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    disableFileAccess: true, disableUrlAccess: true
  });
  return {
    configured: true,
    publicUrl: publicUrl.href,
    async send({ to, subject, text }) {
      const result = await transport.sendMail({ from: env.SMTP_FROM, to: { address: to, name: '' }, subject, text });
      if (!result.accepted?.length) throw new Error('Email was not accepted.');
    }
  };
}
