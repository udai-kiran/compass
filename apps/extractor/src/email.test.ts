/**
 * Tests for parseEmail in email.ts.
 *
 * This file has NO dependency on DATABASE_URL or any external service —
 * parseEmail is a pure function over a raw RFC822 string.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEmail } from "./email.ts";

describe("parseEmail", () => {
  /**
   * This test pins the mailparser → html-to-text → deepmerge-ts chain.
   * When mailparser encounters an HTML-only email it uses the npm html-to-text
   * package (which internally uses deepmerge-ts) to synthesise mail.text.
   * A root-level package.json override forces deepmerge-ts to 8.0.1, past
   * html-to-text's declared ^7.1.5 range. This test is the regression guard
   * that proves the override is safe on that real code path.
   */
  it("an HTML-only email yields readable text via mailparser's html-to-text", async () => {
    const raw = [
      "MIME-Version: 1.0",
      "From: HDFC Bank <noreply@hdfc.com>",
      "To: user@example.com",
      "Subject: Transaction Alert",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body><p>Your HDFC Bank card was charged</p><p>INR 2,499.00 at BLINKIT</p></body></html>",
    ].join("\r\n");

    const result = await parseEmail(raw);

    assert.ok(
      result.body.includes("Your HDFC Bank card was charged"),
      `body should contain 'Your HDFC Bank card was charged'; got: ${result.body}`,
    );
    assert.ok(
      result.body.includes("INR 2,499.00"),
      `body should contain 'INR 2,499.00'; got: ${result.body}`,
    );
    assert.ok(
      result.body.includes("BLINKIT"),
      `body should contain 'BLINKIT'; got: ${result.body}`,
    );
    assert.ok(
      !result.body.includes("<"),
      `body should not contain angle brackets (HTML not fully stripped); got: ${result.body}`,
    );
  });

  it("a text/plain part is preferred over HTML", async () => {
    const raw = [
      "MIME-Version: 1.0",
      "From: sender@example.com",
      "To: recipient@example.com",
      "Subject: Multipart Test",
      'Content-Type: multipart/alternative; boundary="alt-boundary"',
      "",
      "--alt-boundary",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "PLAIN_MARKER this is the plain text version",
      "",
      "--alt-boundary",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body><p>HTML_ONLY_MARKER this is the HTML version</p></body></html>",
      "",
      "--alt-boundary--",
    ].join("\r\n");

    const result = await parseEmail(raw);

    assert.ok(
      result.body.includes("PLAIN_MARKER"),
      `body should contain PLAIN_MARKER from text/plain part; got: ${result.body}`,
    );
    assert.ok(
      !result.body.includes("HTML_ONLY_MARKER"),
      `body should NOT contain HTML_ONLY_MARKER from the HTML part; got: ${result.body}`,
    );
  });

  it("subject and from are extracted", async () => {
    const raw = [
      "MIME-Version: 1.0",
      "From: Axis Bank <alerts@axisbank.com>",
      "To: user@example.com",
      "Subject: Your statement is ready",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Please review your statement.",
    ].join("\r\n");

    const result = await parseEmail(raw);

    assert.equal(result.subject, "Your statement is ready");
    assert.ok(
      result.from.includes("alerts@axisbank.com"),
      `from should contain 'alerts@axisbank.com'; got: ${result.from}`,
    );
  });

  it("an attachment is decoded to bytes", async () => {
    const payloadText = "Hello PDF World";
    const base64Payload = Buffer.from(payloadText, "utf-8").toString("base64");

    const raw = [
      "MIME-Version: 1.0",
      "From: sender@example.com",
      "To: recipient@example.com",
      "Subject: Statement",
      'Content-Type: multipart/mixed; boundary="mix-boundary"',
      "",
      "--mix-boundary",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "See the attached statement.",
      "",
      "--mix-boundary",
      "Content-Type: application/pdf",
      "Content-Transfer-Encoding: base64",
      'Content-Disposition: attachment; filename="statement.pdf"',
      "",
      base64Payload,
      "",
      "--mix-boundary--",
    ].join("\r\n");

    const result = await parseEmail(raw);

    assert.equal(result.attachments.length, 1, "should have exactly one attachment");
    const att = result.attachments[0]!;
    assert.equal(att.filename, "statement.pdf");
    assert.ok(
      att.contentType.startsWith("application/pdf"),
      `contentType should be application/pdf; got: ${att.contentType}`,
    );
    assert.ok(
      att.content instanceof Uint8Array,
      "content should be a Uint8Array",
    );
    const decoded = Buffer.from(att.content).toString("utf-8");
    assert.equal(
      decoded,
      payloadText,
      "decoded attachment content should match the original payload",
    );
  });

  it("whitespace is collapsed and the body is capped", async () => {
    // 5a: multiple consecutive newlines are collapsed to at most two,
    //     and trailing whitespace before newlines is stripped
    const rawCollapse = [
      "MIME-Version: 1.0",
      "From: sender@example.com",
      "To: recipient@example.com",
      "Subject: Whitespace Test",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Line one   \nLine two\n\n\n\n\nLine three",
    ].join("\r\n");

    const resultCollapse = await parseEmail(rawCollapse);

    assert.ok(
      !resultCollapse.body.includes("\n\n\n"),
      `three or more consecutive newlines should be collapsed; got: ${JSON.stringify(resultCollapse.body)}`,
    );
    assert.equal(
      resultCollapse.body,
      resultCollapse.body.trim(),
      "body should be trimmed (no leading/trailing whitespace)",
    );

    // 5b: body capped at MAX_BODY_CHARS (12 000)
    const longText = "A".repeat(15_000);
    const rawLong = [
      "MIME-Version: 1.0",
      "From: sender@example.com",
      "To: recipient@example.com",
      "Subject: Long Body Test",
      "Content-Type: text/plain; charset=utf-8",
      "",
      longText,
    ].join("\r\n");

    const resultLong = await parseEmail(rawLong);

    assert.ok(
      resultLong.body.length <= 12_000,
      `body length ${resultLong.body.length} exceeds MAX_BODY_CHARS (12000)`,
    );
  });
});
