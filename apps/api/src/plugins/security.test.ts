import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyRequest } from "fastify";
import { _test } from "./security.ts";

const { bucketFor, hostOf, AUTH_BUCKET, WRITE_BUCKET, READ_BUCKET } = _test;

function req(method: string, url: string): FastifyRequest {
  return { method, url } as FastifyRequest;
}

test("bucketFor: auth endpoints get the tight brute-force bucket", () => {
  assert.equal(bucketFor(req("POST", "/api/auth/login")).name, AUTH_BUCKET.name);
  assert.equal(bucketFor(req("POST", "/api/auth/register")).name, AUTH_BUCKET.name);
  assert.equal(bucketFor(req("POST", "/api/auth/password")).name, AUTH_BUCKET.name);
});

test("bucketFor: mutations use the write bucket, reads the read bucket", () => {
  assert.equal(bucketFor(req("POST", "/api/transactions")).name, WRITE_BUCKET.name);
  assert.equal(bucketFor(req("DELETE", "/api/accounts/x")).name, WRITE_BUCKET.name);
  assert.equal(bucketFor(req("GET", "/api/dashboard")).name, READ_BUCKET.name);
  assert.equal(bucketFor(req("GET", "/api/auth/sessions?x=1")).name, READ_BUCKET.name);
});

test("auth bucket is the strictest of the three", () => {
  assert.ok(AUTH_BUCKET.limit < WRITE_BUCKET.limit);
  assert.ok(WRITE_BUCKET.limit < READ_BUCKET.limit);
});

test("hostOf: extracts hostname without port, null on garbage", () => {
  assert.equal(hostOf("http://localhost:5173"), "localhost");
  assert.equal(hostOf("https://compass.example.com"), "compass.example.com");
  assert.equal(hostOf("not a url"), null);
});
