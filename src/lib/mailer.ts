import { Resend } from 'resend';

import { env, isTest } from '../config/env.js';

import { logger } from './logger.js';

export type MailMessage = { to: string; subject: string; html: string; text: string };

type Transport = (message: MailMessage) => Promise<void>;

/** Messages captured in tests (read by integration tests to get verification/reset links). */
export const testOutbox: MailMessage[] = [];

function createTransport(): Transport {
  if (isTest) {
    return (message) => {
      testOutbox.push(message);
      return Promise.resolve();
    };
  }
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    const resend = new Resend(env.RESEND_API_KEY);
    const from = env.MAIL_FROM;
    return async (message) => {
      const { error } = await resend.emails.send({ from, ...message });
      if (error) throw new Error(`Resend error: ${error.name}`);
    };
  }
  // Development without Resend: log the email (links included) instead of sending it.
  return (message) => {
    logger.info(
      { mail: { to: message.to, subject: message.subject }, text: message.text },
      'DEV MAIL (not sent)',
    );
    return Promise.resolve();
  };
}

const transport = createTransport();

export const mailer = {
  send: (message: MailMessage): Promise<void> => transport(message),
};
