import "server-only";
import { proposalToken, sha256Hex } from "./tokens";

/** The client link for a proposal. The token is derived server-side from PROPOSAL_LINK_SECRET and never stored. */
export function proposalLink(proposalId: string, clientOrigin: string): { url: string; hash: string } {
  const secret = process.env.PROPOSAL_LINK_SECRET;
  if (!secret) throw new Error("PROPOSAL_LINK_SECRET is not set (server-only; see platform/.env.example)");
  const token = proposalToken(secret, proposalId);
  return { url: `${clientOrigin}/p/${token}`, hash: sha256Hex(token) };
}
