import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  type Request = {
    /** Set by the requestId middleware. */
    id: string;
  };
}
