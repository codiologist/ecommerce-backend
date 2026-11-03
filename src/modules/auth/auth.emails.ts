import { env } from '../../config/env.js';

import type { MailMessage } from '../../lib/mailer.js';

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${escapeHtml(title)}</h2>${bodyHtml}
<p style="color:#666;font-size:12px;margin-top:32px">If you did not request this, you can ignore this email.</p>
</body></html>`;
}

const button = (href: string, label: string) =>
  `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#666">Or paste this link into your browser:<br>${escapeHtml(href)}</p>`;

export const frontendLink = (path: string, token?: string) => {
  const url = new URL(path, env.FRONTEND_URL);
  if (token) url.searchParams.set('token', token);
  return url.toString();
};

export const authEmails = {
  verifyEmail(to: string, name: string, link: string): MailMessage {
    return {
      to,
      subject: 'Verify your email address',
      text: `Hi ${name},\n\nPlease verify your email address: ${link}\n\nThis link expires in 24 hours.`,
      html: layout(
        'Verify your email address',
        `<p>Hi ${escapeHtml(name)},</p><p>Please confirm your email address. This link expires in 24 hours.</p>${button(link, 'Verify email')}`,
      ),
    };
  },

  /** Sent when someone tries to register with an existing email (no enumeration in the API). */
  accountExists(to: string, loginLink: string, resetLink: string): MailMessage {
    return {
      to,
      subject: 'Sign-up attempt with your email',
      text: `Someone tried to create an account with this email, but you already have one.\nLog in: ${loginLink}\nForgot your password? ${resetLink}`,
      html: layout(
        'You already have an account',
        `<p>Someone tried to create an account with this email address, but an account already exists.</p>${button(loginLink, 'Log in')}<p>Forgot your password? <a href="${escapeHtml(resetLink)}">Reset it</a>.</p>`,
      ),
    };
  },

  resetPassword(to: string, name: string, link: string): MailMessage {
    return {
      to,
      subject: 'Reset your password',
      text: `Hi ${name},\n\nReset your password: ${link}\n\nThis link expires in 15 minutes and can be used once.`,
      html: layout(
        'Reset your password',
        `<p>Hi ${escapeHtml(name)},</p><p>This link expires in 15 minutes and can be used once.</p>${button(link, 'Reset password')}`,
      ),
    };
  },

  passwordChanged(to: string, name: string): MailMessage {
    return {
      to,
      subject: 'Your password was changed',
      text: `Hi ${name},\n\nYour password was just changed and your other sessions were signed out. If this wasn't you, reset your password immediately: ${frontendLink('/forgot-password')}`,
      html: layout(
        'Your password was changed',
        `<p>Hi ${escapeHtml(name)},</p><p>Your password was just changed and your other sessions were signed out.</p><p>If this wasn't you, <a href="${escapeHtml(frontendLink('/forgot-password'))}">reset your password</a> immediately.</p>`,
      ),
    };
  },
};
