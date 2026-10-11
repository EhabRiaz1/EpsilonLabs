// Invite links. The token is the credential (like a magic link): only its sha256 is stored, it expires in 7 days
// and works once. Pure (unit-tested).
import { randomBytes } from "node:crypto";
import { sha256Hex } from "./tokens";

export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256Hex(token) };
}

export function inviteUrl(clientOrigin: string, token: string): string {
  return `${clientOrigin.replace(/\/$/, "")}/invite/${token}`;
}
