import nodemailer, { type Transporter } from 'nodemailer';

import { env, isProduction, isTest } from '../config/env.js';

import { logger } from './logger.js';

export type MailMessage = { to: string; subject: string; html: string; text: string };

type Transport = (message: MailMessage) => Promise<void>;

/** Messages captured in tests (read by integration tests to get verification/reset links). */
export const testOutbox: MailMessage[] = [];

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
  /** Require a STARTTLS upgrade when not using implicit TLS (always on in production). */
  requireTLS: boolean;
};

/** Nodemailer SMTP transport (pooled connections, bounded timeouts). */
export function createSmtpTransport(config: SmtpConfig): {
  transporter: Transporter;
  send: Transport;
} {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure && config.requireTLS,
    ...(config.user && config.pass ? { auth: { user: config.user, pass: config.pass } } : {}),
    pool: true,
    maxConnections: 3,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2' },
  });
  return {
    transporter,
    send: async (message) => {
      await transporter.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

/** One readable line per email in development, with any links pulled out so they're easy to click. */
function logTransport(): Transport {
  return (message) => {
    const links = message.text.match(/https?:\/\/\S+/g) ?? [];
    logger.info(
      `DEV MAIL (not sent, set SMTP_HOST to send) → ${message.to} | ${message.subject}${links.length ? ` | ${links.join(' ')}` : ''}`,
    );
    return Promise.resolve();
  };
}

function createTransport(): Transport {
  if (isTest) {
    return (message) => {
      testOutbox.push(message);
      return Promise.resolve();
    };
  }
  if (env.SMTP_HOST) {
    return createSmtpTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.MAIL_FROM ?? 'Store <no-reply@localhost>',
      requireTLS: isProduction,
    }).send;
  }
  return logTransport();
}

const transport = createTransport();

export const mailer = {
  send: (message: MailMessage): Promise<void> => transport(message),
};
