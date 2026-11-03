import { randomInt } from 'node:crypto';

import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

import { env } from '../../config/env.js';
import { decrypt, encrypt, sha256 } from '../../lib/crypto.js';

const BACKUP_CODE_COUNT = 10;
/** Crockford-style alphabet without look-alikes (0/o, 1/l/i). */
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Accept the previous/next 30s step for clock drift. */
const EPOCH_TOLERANCE_SECONDS = 30;

export const totp = {
  createSecret(): { secret: string; encrypted: string } {
    const secret = generateSecret();
    return { secret, encrypted: encrypt(secret, env.TOTP_ENCRYPTION_KEY) };
  },

  async setupPayload(secret: string, accountLabel: string) {
    const otpauthUri = generateURI({ issuer: env.TOTP_ISSUER, label: accountLabel, secret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, {
      errorCorrectionLevel: 'M',
      margin: 1,
    });
    return { otpauthUri, qrCodeDataUrl, secret };
  },

  /**
   * Verifies a 6-digit code. `afterTimeStep` rejects codes from an already-used time step (replay).
   * Returns the accepted time step so the caller can persist it.
   */
  async verifyCode(
    encryptedSecret: string,
    code: string,
    afterTimeStep: number | null,
  ): Promise<{ valid: true; timeStep: number } | { valid: false }> {
    const secret = decrypt(encryptedSecret, env.TOTP_ENCRYPTION_KEY);
    const result = await verify({
      secret,
      token: code,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
      ...(afterTimeStep !== null ? { afterTimeStep } : {}),
    });
    if (result.valid && 'timeStep' in result && typeof result.timeStep === 'number') {
      return { valid: true, timeStep: result.timeStep };
    }
    return { valid: false };
  },
};

export const backupCodes = {
  /**
   * Returns plaintext codes (shown once) and their SHA-256 hashes (stored).
   * 10 chars from a 31-char alphabet ≈ 49 bits each; single-use and rate-limited.
   */
  generate(): { codes: string[]; hashes: string[] } {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => {
      const raw = Array.from(
        { length: 10 },
        () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)],
      ).join('');
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    return { codes, hashes: codes.map((code) => sha256(normalize(code))) };
  },
  hash: (code: string): string => sha256(normalize(code)),
};

function normalize(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
