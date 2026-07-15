import { test } from "node:test";
import assert from "node:assert/strict";
import { chipFor, findInstitution, INSTITUTIONS, isLight } from "./institutions.ts";

test("resolves the spellings a human actually types", () => {
  assert.equal(findInstitution("HDFC")?.label, "HDFC");
  assert.equal(findInstitution("hdfc")?.label, "HDFC");
  assert.equal(findInstitution("  HDFC  ")?.label, "HDFC");
  assert.equal(findInstitution("HDFC Bank")?.label, "HDFC");
  assert.equal(findInstitution("hdfc bank ltd")?.label, "HDFC");
  assert.equal(findInstitution("State Bank of India")?.label, "SBI");
  assert.equal(findInstitution("ICICI Bank")?.label, "ICICI");
  assert.equal(findInstitution("kotak mahindra bank")?.label, "Kotak");
});

test("trailing-word fallback stops before matching the wrong bank", () => {
  // "Bank of Baroda" must not degrade to a bare "Bank" and land anywhere.
  assert.equal(findInstitution("Bank of Baroda")?.label, "Bank of Baroda");
  assert.equal(findInstitution("BoB")?.label, "Bank of Baroda");
});

test("unknown institutions resolve to null, not a wrong guess", () => {
  assert.equal(findInstitution("Saraswat Co-operative"), null);
  assert.equal(findInstitution("Some Credit Union"), null);
  assert.equal(findInstitution(""), null);
  assert.equal(findInstitution(null), null);
});

test("EPFO and NPS resolve — they issue the accounts these types live in", () => {
  assert.equal(findInstitution("EPFO")?.label, "EPFO");
  assert.equal(findInstitution("Employees Provident Fund")?.label, "EPFO");
  assert.equal(findInstitution("NSDL")?.label, "NSDL");
  assert.equal(findInstitution("Post Office")?.label, "India Post");
});

test("every brand colour is a parseable 6-digit hex", () => {
  // isLight() does parseInt on the hex; a malformed value yields NaN and
  // silently paints white-on-light.
  for (const inst of INSTITUTIONS) {
    assert.match(inst.color, /^#[0-9A-Fa-f]{6}$/, `${inst.label} has a bad colour`);
  }
});

test("monograms stay short enough for a 20px chip", () => {
  for (const inst of INSTITUTIONS) {
    assert.ok(inst.monogram.length <= 3, `${inst.label} monogram "${inst.monogram}" is too long`);
    assert.ok(inst.monogram.length >= 1, `${inst.label} has an empty monogram`);
  }
});

test("an unknown institution still gets a readable chip", () => {
  // Falling back to initials is why an unlisted co-op bank isn't a blank square.
  assert.equal(chipFor("Saraswat Co-operative").monogram, "SC");
  assert.equal(chipFor("Saraswat Co-operative").title, "Saraswat Co-operative");
  assert.equal(chipFor("Zoroastrian").monogram, "ZO");
  assert.equal(chipFor("!!!").monogram, "?");
});

test("known institutions keep their brand chip", () => {
  assert.equal(chipFor("hdfc bank").monogram, "H");
  assert.equal(chipFor("hdfc bank").color, "#004C8F");
  assert.equal(chipFor("State Bank of India").title, "SBI");
});

test("label colour follows background brightness", () => {
  assert.equal(isLight("#F58220"), true, "ICICI orange needs dark text");
  assert.equal(isLight("#003874"), false, "Kotak navy needs light text");
  assert.equal(isLight("#FFFFFF"), true);
  assert.equal(isLight("#000000"), false);
});

test("no alias is claimed by two institutions", () => {
  // A duplicate would make the chip depend on array order.
  const seen = new Set<string>();
  for (const inst of INSTITUTIONS) {
    for (const key of [inst.label.toLowerCase(), ...inst.aliases]) {
      assert.ok(!seen.has(key), `"${key}" is claimed twice`);
      seen.add(key);
    }
  }
});
