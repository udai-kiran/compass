import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The docs site is served by this app's Caddy container at /docs/ (not GitHub
// Pages). That contract lives entirely in the Caddyfile + Dockerfile, so pin
// the parts that silently break the docs or the SPA if they regress.
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const caddyfile = read("Caddyfile");
const dockerfile = read("Dockerfile");

test("Caddy serves the docs build under /docs/", () => {
  assert.match(caddyfile, /handle \/docs\/\*/);
  assert.match(caddyfile, /redir \/docs \/docs\//);
});

test("the API and health proxies are matched before the catch-all", () => {
  const api = caddyfile.indexOf("handle /api/*");
  const health = caddyfile.indexOf("handle /health");
  const docs = caddyfile.indexOf("handle /docs/*");
  const catchAll = caddyfile.indexOf("\thandle {");
  assert.ok(api > -1 && health > -1 && docs > -1 && catchAll > -1);
  assert.ok(api < catchAll, "/api/* must precede the catch-all");
  assert.ok(health < catchAll, "/health must precede the catch-all");
  assert.ok(docs < catchAll, "/docs/* must precede the catch-all");
});

test("the SPA fallback still rewrites unknown app paths to index.html", () => {
  assert.match(caddyfile, /try_files \{path\} \/index\.html/);
});

test("a missing docs page answers 404 rather than 200", () => {
  assert.match(caddyfile, /handle_errors/);
  assert.match(caddyfile, /rewrite \* \/docs\/404\.html/);
  assert.match(caddyfile, /status 404/);
});

test("the web image builds the docs and ships them at /srv/docs", () => {
  assert.match(dockerfile, /COPY apps\/docs\/package\.json/);
  assert.match(dockerfile, /npm run build -w apps\/docs/);
  assert.match(dockerfile, /COPY --from=build \/app\/apps\/docs\/build \/srv\/docs/);
});

test("docs are copied after the web build so docs edits don't rebuild the SPA", () => {
  const webBuild = dockerfile.indexOf("npm run build -w apps/web");
  const docsCopy = dockerfile.indexOf("COPY apps/docs ./apps/docs");
  assert.ok(webBuild > -1 && docsCopy > -1);
  assert.ok(docsCopy > webBuild, "COPY apps/docs must come after the web build");
});
