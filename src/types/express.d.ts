import type { Role } from '@prisma/client';

export type AuthContext = {
  userId: string;
  role: Role;
  email: string;
  emailVerified: boolean;
  /** Stable id of the login session (refresh-token family). */
  sessionFamilyId: string;
  /** Current refresh-token row of the family. */
  sessionId: string;
  twoFactorVerified: boolean;
  twoFactorEnabled: boolean;
  reauthAt: Date | null;
};

declare global {
  // Express's documented augmentation point.
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration merging needs an interface
    interface Request {
      /** Set by the requestId middleware. */
      id: string;
      /** Set by the authenticate middleware. */
      auth?: AuthContext;
    }
  }
}
