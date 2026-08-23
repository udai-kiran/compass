/**
 * payslip-parse.test.ts — Unit tests for payslip parsing pure functions.
 *
 * Tests the hermetically-testable seams:
 *   - parsePayslipFromTurn: three-way tool-call discipline
 *   - rupeesToPaise: deterministic rupees → paise conversion
 *   - redactPayslipText: PII never reaches the request body
 *
 * No DB, no model, no network — all tests are synchronous and fast.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePayslipFromTurn,
  rupeesToPaise,
  redactPayslipText,
  PARSE_PAYSLIP_TOOL,
} from "./payslip-parse.ts";
import type { ChatTurn } from "@compass/ai";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** A minimal valid model output object (as would come from the tool call input). */
const VALID_OUTPUT = {
  payMonth: "2025-06",
  employerName: "ACME Corp",
  grossRupees: 50000,
  netRupees: 42000,
  tdsCurrentRupees: 3000,
  tdsYtdRupees: 15000,
  components: [
    {
      rawLabel: "Basic Salary",
      canonicalKind: "basic",
      category: "earning",
      currentRupees: 25000,
      ytdRupees: 125000,
      sourceQuote: "Basic Salary: ₹25,000",
      confidence: 0.99,
    },
    {
      rawLabel: "Employee PF",
      canonicalKind: "employee_epf",
      category: "deduction",
      currentRupees: 1800,
      confidence: 0.95,
    },
  ],
};

function makeTurn(overrides?: { toolCalls?: ChatTurn["toolCalls"]; text?: string }): ChatTurn {
  return {
    toolCalls: overrides?.toolCalls ?? [],
    text: overrides?.text ?? "",
  };
}

// ─── parsePayslipFromTurn ─────────────────────────────────────────────────────

describe("parsePayslipFromTurn", () => {
  it("returns parsed output with 1 matching tool call", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          id: "call1",
          name: PARSE_PAYSLIP_TOOL.name,
          input: VALID_OUTPUT,
        },
      ],
    });
    const result = parsePayslipFromTurn(turn);
    assert.ok(result !== null);
    assert.equal(result!.payMonth, "2025-06");
    assert.equal(result!.employerName, "ACME Corp");
    assert.equal(result!.components.length, 2);
    assert.equal(result!.components[0]!.canonicalKind, "basic");
    assert.equal(result!.components[1]!.canonicalKind, "employee_epf");
  });

  it("falls back to prose JSON with 0 matching tool calls (Ollama path)", () => {
    const turn = makeTurn({
      toolCalls: [],
      text: JSON.stringify(VALID_OUTPUT),
    });
    const result = parsePayslipFromTurn(turn);
    assert.ok(result !== null);
    assert.equal(result!.payMonth, "2025-06");
    assert.equal(result!.components.length, 2);
  });

  it("FAILS CLOSED with 2+ matching tool calls", () => {
    const turn = makeTurn({
      toolCalls: [
        { id: "call1", name: PARSE_PAYSLIP_TOOL.name, input: VALID_OUTPUT },
        { id: "call2", name: PARSE_PAYSLIP_TOOL.name, input: VALID_OUTPUT },
      ],
    });
    const result = parsePayslipFromTurn(turn);
    assert.equal(result, null, "2+ tool calls must fail closed — never an arbitrary pick");
  });

  it("returns null for a wrong-name tool call (no prose JSON fallback)", () => {
    const turn = makeTurn({
      toolCalls: [{ id: "call1", name: "wrong_tool", input: VALID_OUTPUT }],
      text: "",
    });
    const result = parsePayslipFromTurn(turn);
    // 0 matching calls → prose fallback → empty string → null
    assert.equal(result, null);
  });

  it("returns null for malformed model output", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          id: "call1",
          name: PARSE_PAYSLIP_TOOL.name,
          input: { components: "not-an-array" }, // invalid
        },
      ],
    });
    const result = parsePayslipFromTurn(turn);
    assert.equal(result, null);
  });

  it("returns null for output with non-finite amounts", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          id: "call1",
          name: PARSE_PAYSLIP_TOOL.name,
          input: {
            ...VALID_OUTPUT,
            grossRupees: Infinity,
          },
        },
      ],
    });
    const result = parsePayslipFromTurn(turn);
    assert.equal(result, null);
  });

  it("returns null for component with unknown canonicalKind", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          id: "call1",
          name: PARSE_PAYSLIP_TOOL.name,
          input: {
            components: [
              {
                rawLabel: "Mystery",
                canonicalKind: "unknown_kind",
                category: "earning",
                currentRupees: 1000,
              },
            ],
          },
        },
      ],
    });
    const result = parsePayslipFromTurn(turn);
    assert.equal(result, null);
  });

  it("accepts a vpf component (voluntary PF flows to the EPF passbook VPF columns)", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          id: "call1",
          name: PARSE_PAYSLIP_TOOL.name,
          input: {
            payMonth: "2025-06",
            components: [
              {
                rawLabel: "Voluntary PF",
                canonicalKind: "vpf",
                category: "deduction",
                currentRupees: 5000,
                confidence: 0.9,
              },
            ],
          },
        },
      ],
    });
    const result = parsePayslipFromTurn(turn);
    assert.ok(result !== null);
    assert.equal(result!.components.length, 1);
    assert.equal(result!.components[0]!.canonicalKind, "vpf");
    assert.equal(rupeesToPaise(result!.components[0]!.currentRupees), 500000);
    // The tool spec must advertise "vpf" or the model can never emit it.
    const kindProp = (
      PARSE_PAYSLIP_TOOL.inputSchema as {
        properties: {
          components: { items: { properties: { canonicalKind: { enum: string[] } } } };
        };
      }
    ).properties.components.items.properties.canonicalKind;
    assert.ok(kindProp.enum.includes("vpf"), 'tool enum must include "vpf"');
  });

  it("accepts output with only required fields (optional fields absent)", () => {
    const turn = makeTurn({
      toolCalls: [
        {
          id: "call1",
          name: PARSE_PAYSLIP_TOOL.name,
          input: {
            components: [
              {
                rawLabel: "Basic",
                canonicalKind: "basic",
                category: "earning",
                currentRupees: 10000,
              },
            ],
          },
        },
      ],
    });
    const result = parsePayslipFromTurn(turn);
    assert.ok(result !== null);
    assert.equal(result!.payMonth, undefined);
    assert.equal(result!.employerName, undefined);
    assert.equal(result!.components[0]!.ytdRupees, undefined);
  });
});

// ─── rupeesToPaise ───────────────────────────────────────────────────────────

describe("rupeesToPaise", () => {
  it("converts whole rupees exactly", () => {
    assert.equal(rupeesToPaise(50000), 5000000);
    assert.equal(rupeesToPaise(1), 100);
    assert.equal(rupeesToPaise(0), 0);
  });

  it("rounds fractional rupees correctly", () => {
    // Use values that are exact in IEEE 754 to avoid floating-point ambiguity.
    assert.equal(rupeesToPaise(25.5), 2550);
    assert.equal(rupeesToPaise(0.01), 1);
    assert.equal(rupeesToPaise(0.009), 1); // rounds up
    assert.equal(rupeesToPaise(0.001), 0); // rounds down
    assert.equal(rupeesToPaise(99.99), 9999);
    assert.equal(rupeesToPaise(1.25), 125);
  });

  it("handles negative amounts (adjustments)", () => {
    assert.equal(rupeesToPaise(-100), -10000);
  });

  it("returns null for non-finite values", () => {
    assert.equal(rupeesToPaise(Infinity), null);
    assert.equal(rupeesToPaise(-Infinity), null);
    assert.equal(rupeesToPaise(NaN), null);
  });

  it("returns null for null/undefined", () => {
    assert.equal(rupeesToPaise(null), null);
    assert.equal(rupeesToPaise(undefined), null);
  });

  it("handles large but safe salaries", () => {
    // ₹1 crore = 10,000,000 rupees = 1,000,000,000 paise (1 billion, safe integer)
    assert.equal(rupeesToPaise(10000000), 1000000000);
  });
});

// ─── redactPayslipText ────────────────────────────────────────────────────────

describe("redactPayslipText", () => {
  const EMPTY_IDENTITY = { names: [], emails: [], upiIds: [] };
  const IDENTITY = {
    names: ["Rahul Sharma"],
    emails: ["rahul.sharma@example.com"],
    upiIds: ["rahul@oksbi"],
  };

  it("redacts PAN numbers from payslip text", () => {
    const text = "Employee PAN: ABCDE1234F, Salary: ₹50,000";
    const result = redactPayslipText(text, EMPTY_IDENTITY);
    assert.ok(!result.includes("ABCDE1234F"), "PAN should be redacted");
    assert.ok(result.includes("[pan]"), "PAN placeholder should be present");
    assert.ok(result.includes("₹50,000"), "salary amount should be preserved");
  });

  it("redacts Aadhaar numbers from payslip text", () => {
    const text = "Aadhaar: 1234 5678 9012, Department: Engineering";
    const result = redactPayslipText(text, EMPTY_IDENTITY);
    assert.ok(!result.includes("1234 5678 9012"), "Aadhaar should be redacted");
    assert.ok(result.includes("[aadhaar]"), "Aadhaar placeholder should be present");
    assert.ok(result.includes("Engineering"), "non-PII should be preserved");
  });

  it("redacts phone numbers from payslip text", () => {
    const text = "Contact: +91 9876543210, Designation: Engineer";
    const result = redactPayslipText(text, EMPTY_IDENTITY);
    assert.ok(!result.includes("9876543210"), "phone number should be redacted");
    assert.ok(result.includes("[phone]"), "phone placeholder should be present");
  });

  it("redacts IFSC codes from payslip text", () => {
    const text = "Bank: HDFC0001234, Branch: Mumbai";
    const result = redactPayslipText(text, EMPTY_IDENTITY);
    assert.ok(!result.includes("HDFC0001234"), "IFSC should be redacted");
    assert.ok(result.includes("[ifsc]"), "IFSC placeholder should be present");
  });

  it("redacts employee code in labelled form", () => {
    const text = "Employee Code: EMP12345, Basic Salary: 25000";
    const result = redactPayslipText(text, EMPTY_IDENTITY);
    assert.ok(!result.includes("EMP12345"), "employee code should be redacted");
    assert.ok(result.includes("[emp_id]"), "emp_id placeholder should be present");
    assert.ok(result.includes("Basic Salary"), "non-PII labels should be preserved");
  });

  it("redacts employee names in labelled fields without a stored identity match", () => {
    const result = redactPayslipText("Employee Name: Rahul Sharma", EMPTY_IDENTITY);

    assert.equal(result, "Employee Name: [REDACTED]");
  });

  it("redacts dates of birth in labelled fields", () => {
    const result = redactPayslipText("Date of Birth: 01-01-1990", EMPTY_IDENTITY);

    assert.equal(result, "DOB: [REDACTED]");
  });

  it("redacts known employee names from payslip text", () => {
    const text = "Dear Rahul Sharma, your June 2025 payslip is attached.";
    const result = redactPayslipText(text, IDENTITY);
    assert.ok(!result.includes("Rahul Sharma"), "name should be redacted");
  });

  it("preserves salary component names and amounts", () => {
    const text = "Basic Salary: 25000\nHRA: 10000\nEmployee PF: 1800\nTDS: 3000";
    const result = redactPayslipText(text, EMPTY_IDENTITY);
    // Component names and amounts should survive
    assert.ok(result.includes("Basic Salary"), "component label should be preserved");
    assert.ok(result.includes("HRA"), "HRA should be preserved");
    assert.ok(result.includes("Employee PF"), "EPF label should be preserved");
    assert.ok(result.includes("TDS"), "TDS label should be preserved");
    assert.ok(result.includes("25000"), "amounts should be preserved");
  });

  it("handles empty text gracefully", () => {
    assert.equal(redactPayslipText("", EMPTY_IDENTITY), "");
  });
});
