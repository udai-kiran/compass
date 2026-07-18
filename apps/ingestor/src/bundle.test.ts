import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectBundleSchema } from "@compass/shared";
import { decodeBundle, encodeBundle, type Bundle } from "./bundle.ts";

const sample: Bundle = {
  v: 1,
  provider: "google",
  email: "me@gmail.com",
  folder: "INBOX",
  clientId: "123.apps.googleusercontent.com",
  clientSecret: "GOCSPX-secret",
  refreshToken: "1//refresh",
};

test("encode/decode round-trips the bundle", () => {
  assert.deepEqual(decodeBundle(encodeBundle(sample)), sample);
});

test("encoded bundle satisfies the API's ConnectBundleSchema", () => {
  // The CLI encodes and the API decodes+validates with this schema — keep them
  // in lockstep so a captured bundle is always accepted.
  const decoded = decodeBundle(encodeBundle(sample));
  assert.equal(ConnectBundleSchema.safeParse(decoded).success, true);
});

test("a bundle missing a field is rejected by the schema", () => {
  const { refreshToken: _omit, ...partial } = sample;
  const encoded = Buffer.from(JSON.stringify(partial), "utf8").toString("base64");
  assert.equal(ConnectBundleSchema.safeParse(decodeBundle(encoded)).success, false);
});
