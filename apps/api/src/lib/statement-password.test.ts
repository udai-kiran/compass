import { test } from "node:test";
import assert from "node:assert/strict";
import { nameKey, statementPasswordCandidates } from "./statement-password.ts";

test("nameKey: first 4 letters, letters only, uppercased", () => {
  assert.equal(nameKey("Ravi Shankar"), "RAVI");
  assert.equal(nameKey("Al Sharma"), "ALSH"); // spaces skipped, spills into surname
  assert.equal(nameKey("jo"), "JO"); // shorter than 4 is fine
});

test("HDFC (confirmed): name+last-4 first, then name+DDMM when DOB is known", () => {
  // last-4 only (no DOB on file) — the one derivable candidate
  assert.deepEqual(
    statementPasswordCandidates({ issuer: "HDFC", holderName: "Ravi Shankar", last4: "5678" }),
    ["RAVI5678"],
  );
  // with DOB, the image's two HDFC options lead the list, in order
  const withDob = statementPasswordCandidates({
    issuer: "HDFC",
    holderName: "Ravi Shankar",
    last4: "5591 9700 1234 5678", // digits extracted → 5678
    dob: "1975-12-05",
  });
  assert.equal(withDob[0], "RAVI5678");
  assert.equal(withDob[1], "RAVI0512"); // DD=05, MM=12
});

test("SBI (confirmed): birth DDMMYYYY + last-4, per the bank's own example", () => {
  // From SBI's instruction: DOB 01.04.1980 + last-4 1234 → 010419801234
  assert.equal(
    statementPasswordCandidates({ issuer: "SBI", last4: "1234", dob: "1980-04-01" })[0],
    "010419801234",
  );
  // SBI's own scheme needs the DOB; without it, only the generic name+last-4
  // fallback is offered (harmless to try, and a stored password takes precedence)
  assert.deepEqual(
    statementPasswordCandidates({ issuer: "SBI", holderName: "Ravi", last4: "4321" }),
    ["RAVI4321"],
  );
});

test("unknown issuer falls back to the common candidates", () => {
  const cands = statementPasswordCandidates({ issuer: "Some New Bank", holderName: "Ravi", last4: "9999" });
  assert.deepEqual(cands, ["RAVI9999"]);
});

test("no derivable inputs → empty list (caller must prompt)", () => {
  assert.deepEqual(statementPasswordCandidates({ issuer: "ICICI", holderName: "", last4: "" }), []);
  // DOB-only, no name/last4, unknown issuer still yields the DDMMYYYY candidate
  assert.deepEqual(statementPasswordCandidates({ dob: "1975-12-05" }), ["05121975"]);
});
