import type { AccountType } from "@compass/shared";
import { HttpError } from "./errors.ts";

/** The DB `account_type` enum carries an internal `"system"` value (postings model) that must
 * never surface as a public AccountType. Narrow at every DB→public boundary. */
export function assertPublicAccountType(type: string): AccountType {
  if (type === "system") throw new HttpError(500, "system account leaked into a public projection");
  return type as AccountType;
}
