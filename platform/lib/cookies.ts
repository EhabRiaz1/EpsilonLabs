// Session cookies are host-only (EN1, "Auth and tenancy"): a cookie set on client.epsilon-labs.co must never
// be sent to admin.epsilon-labs.co, so the Domain attribute is always removed, whatever a library passes.

export type CookieOpts = {
  domain?: string;
  path?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | "lax" | "strict" | "none";
  [k: string]: unknown;
};

export function hostOnly<T extends CookieOpts | undefined>(options: T, secure: boolean): CookieOpts {
  const rest: CookieOpts = { ...(options ?? {}) };
  delete rest.domain;
  return { ...rest, path: rest.path ?? "/", sameSite: rest.sameSite ?? "lax", secure };
}
