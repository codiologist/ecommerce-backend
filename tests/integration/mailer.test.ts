import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createSmtpTransport } from '../../src/lib/mailer.js';
import { authEmails } from '../../src/modules/auth/auth.emails.js';

/**
 * Sends through the real Nodemailer SMTP transport to the local Mailpit server (docker-compose /
 * CI service) and reads the message back via Mailpit's HTTP API.
 */
const MAILPIT_API = 'http://127.0.0.1:8025/api/v1';
const smtp = { host: '127.0.0.1', port: 1025, secure: false, from: 'Store <no-reply@localhost>' };

type MailpitSummary = { ID: string; Subject: string; To: { Address: string }[] };
type MailpitMessage = { HTML: string; Text: string; From: { Address: string; Name: string } };

async function findMessage(to: string): Promise<MailpitMessage> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: MailpitSummary[] };
    const first = messages[0];
    if (first) {
      return (await (await fetch(`${MAILPIT_API}/message/${first.ID}`)).json()) as MailpitMessage;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No email for ${to} in Mailpit`);
}

const transports: ReturnType<typeof createSmtpTransport>[] = [];
afterAll(() => {
  for (const t of transports) t.transporter.close();
});

describe('SMTP mailer (Nodemailer → Mailpit)', () => {
  it('delivers the verification email with HTML, text and the link', async () => {
    const mailer = createSmtpTransport({ ...smtp, requireTLS: false });
    transports.push(mailer);
    const to = `smtp-${randomUUID()}@example.com`;
    const link = 'http://localhost:3000/verify-email?token=abc123';

    await mailer.send(authEmails.verifyEmail(to, 'Jane <script>', link));

    const message = await findMessage(to);
    expect(message.From).toMatchObject({ Address: 'no-reply@localhost', Name: 'Store' });
    expect(message.Text).toContain(link);
    expect(message.HTML).toContain('href="http://localhost:3000/verify-email?token=abc123"');
    // User-supplied name is escaped in the HTML part.
    expect(message.HTML).toContain('Jane &lt;script&gt;');
    expect(message.HTML).not.toContain('<script>');
  });

  it('refuses to send without TLS when TLS is required (production setting)', async () => {
    const mailer = createSmtpTransport({ ...smtp, requireTLS: true });
    transports.push(mailer);
    await expect(
      mailer.send({ to: 'x@example.com', subject: 's', text: 't', html: '<p>t</p>' }),
    ).rejects.toThrow();
  });
});
