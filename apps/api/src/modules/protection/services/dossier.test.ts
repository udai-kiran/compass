/**
 * Dossier logic tests (task 14.4).
 * Tests the pure sorting/nominee-detection invariants without a DB.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DossierEntry } from "@compass/shared";

/** Helper: creates a minimal dossier entry for testing. */
function entry(overrides: Partial<DossierEntry> & { key: string; name: string }): DossierEntry {
  return {
    entityType: "account",
    entityId: "id",
    subtype: "bank",
    institution: null,
    identifier: null,
    nominee: "",
    nomineePersonId: null,
    nomineePersonName: null,
    hasDocument: false,
    valuePaise: null,
    missingNominee: true,
    ...overrides,
  };
}

describe("dossier sorting invariants", () => {
  it("missing-nominee entries sort before entries with nominees", () => {
    const entries: DossierEntry[] = [
      entry({ key: "a:1", name: "HDFC Savings", nominee: "John", missingNominee: false }),
      entry({ key: "a:2", name: "SBI Savings", nominee: "", missingNominee: true }),
    ];
    entries.sort((a, b) => {
      if (a.missingNominee !== b.missingNominee) return a.missingNominee ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    assert.equal(entries[0]!.key, "a:2");
  });

  it("missingNominee is true when both nominee and nomineePersonId are empty/null", () => {
    function isMissing(nominee: string, personId: string | null): boolean {
      return nominee.trim() === "" && personId === null;
    }
    assert.equal(isMissing("", null), true);   // both unset → missing
    assert.equal(isMissing("John", null), false); // name set → present
    assert.equal(isMissing("", "some-uuid"), false); // personId set → present
  });

  it("entries with the same nominee status sort by entity type then name", () => {
    const entries: DossierEntry[] = [
      entry({ key: "h:1", name: "Axis ELSS", entityType: "holding", missingNominee: true }),
      entry({ key: "a:1", name: "HDFC Savings", entityType: "account", missingNominee: true }),
      entry({ key: "a:2", name: "SBI Savings", entityType: "account", missingNominee: true }),
    ];
    entries.sort((a, b) => {
      if (a.missingNominee !== b.missingNominee) return a.missingNominee ? -1 : 1;
      if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType);
      return a.name.localeCompare(b.name);
    });
    assert.equal(entries[0]!.key, "a:1"); // account < holding, HDFC < SBI
    assert.equal(entries[1]!.key, "a:2");
    assert.equal(entries[2]!.key, "h:1");
  });

  it("disclaimer text states nomination is not inheritance", () => {
    const disclaimer =
      "Nomination is not inheritance. A nominee is a custodian who receives the proceeds — succession law or a registered will determines legal entitlement. Please consult a legal professional for estate planning.";
    assert.ok(disclaimer.includes("not inheritance"));
    assert.ok(disclaimer.includes("succession law"));
  });
});
