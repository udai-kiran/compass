/**
 * The paste bundle the `connect` CLI prints and the API decodes. Kept in its own
 * module (no side effects) so both the CLI and its tests can import the codec
 * without running the CLI's entrypoint. The API validates the decoded shape with
 * ConnectBundleSchema from @compass/shared.
 */
export interface Bundle {
  v: 1;
  provider: "google";
  email: string;
  folder: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function encodeBundle(b: Bundle): string {
  return Buffer.from(JSON.stringify(b), "utf8").toString("base64");
}

export function decodeBundle(s: string): Bundle {
  return JSON.parse(Buffer.from(s, "base64").toString("utf8")) as Bundle;
}
