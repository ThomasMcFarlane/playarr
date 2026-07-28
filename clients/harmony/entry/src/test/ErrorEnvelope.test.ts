// entry/src/test/ErrorEnvelope.test.ts
//
// Pure Node unit tests for core/ErrorEnvelope.ts (brief section 4.2 / 7.2).
// This file imports only the plain-TypeScript core module below and node's
// own test/assert builtins -- no ArkUI, no @kit.*/@ohos.* imports, no
// decorators.
//
// Covers the three distinct wire shapes plus the two failure kinds, all of
// which decodeErrorEnvelope must tell apart correctly:
//   1. The general envelope {error, message} -- every non-OAuth error,
//      including every "stable code seen" the brief lists, and forward
//      compatibility with an unrecognised code.
//   2. The OAuth-token envelope {error} only, ALWAYS at HTTP 400 -- and the
//      negative space around it: the same one-field body at a different
//      status is NOT this shape, and a two-field body AT 400 falls through
//      to the general shape instead.
//   3. The dedicated 426 upgrade-required envelope
//      {error:"client_upgrade_required", minimum_version} -- and that a 426
//      response never falls back to the general shape even when it has a
//      message field, plus that the same code string at a non-426 status is
//      an ordinary general envelope.
//   4. That a non-JSON content-type (most commonly the static-SPA
//      index.html fallback) is rejected purely on Content-Type, before any
//      JSON.parse is attempted -- proven by feeding it a body that IS valid
//      JSON and confirming it still comes back "not_json" rather than being
//      opportunistically parsed.
//   5. That genuinely malformed JSON-content-typed bodies come back
//      "malformed" (a distinct outcome from "not_json") and that
//      decodeErrorEnvelope never throws.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  decodeErrorEnvelope,
  ErrorEnvelopeResult,
  KnownErrorCode,
  OAuthErrorCode,
} from "../main/ets/core/ErrorEnvelope";

const JSON_CONTENT_TYPE = "application/json";
const HTML_CONTENT_TYPE = "text/html";

/** Shape 1 on the wire, built through an explicit interface (no `any`). */
interface GeneralWireBody {
  error: string;
  message: string;
}

/** Shape 2 on the wire -- exactly one field, no `message`. */
interface OAuthWireBody {
  error: string;
}

/** Shape 3 on the wire. */
interface UpgradeWireBody {
  error: string;
  minimum_version: string;
}

function generalBodyText(code: string, message: string): string {
  const body: GeneralWireBody = { error: code, message: message };
  return JSON.stringify(body);
}

function oauthBodyText(code: string): string {
  const body: OAuthWireBody = { error: code };
  return JSON.stringify(body);
}

function upgradeBodyText(code: string, minimumVersion: string): string {
  const body: UpgradeWireBody = { error: code, minimum_version: minimumVersion };
  return JSON.stringify(body);
}

function assertGeneral(
  result: ErrorEnvelopeResult,
  expectedStatus: number,
  expectedCode: string,
  expectedMessage: string
): void {
  assert.equal(result.kind, "general");
  if (result.kind !== "general") {
    return;
  }
  assert.equal(result.status, expectedStatus);
  assert.equal(result.code, expectedCode);
  assert.equal(result.message, expectedMessage);
}

function assertOAuth(result: ErrorEnvelopeResult, expectedStatus: number, expectedCode: string): void {
  assert.equal(result.kind, "oauth");
  if (result.kind !== "oauth") {
    return;
  }
  assert.equal(result.status, expectedStatus);
  assert.equal(result.code, expectedCode);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "message"), false);
}

function assertUpgradeRequired(result: ErrorEnvelopeResult, expectedMinimumVersion: string): void {
  assert.equal(result.kind, "upgrade_required");
  if (result.kind !== "upgrade_required") {
    return;
  }
  assert.equal(result.status, 426);
  assert.equal(result.minimumVersion, expectedMinimumVersion);
}

function assertNotJson(result: ErrorEnvelopeResult, expectedStatus: number, expectedContentType: string | null): void {
  assert.equal(result.kind, "not_json");
  if (result.kind !== "not_json") {
    return;
  }
  assert.equal(result.status, expectedStatus);
  assert.equal(result.contentType, expectedContentType);
}

function assertMalformed(result: ErrorEnvelopeResult, expectedStatus: number, expectedBodyText: string): void {
  assert.equal(result.kind, "malformed");
  if (result.kind !== "malformed") {
    return;
  }
  assert.equal(result.status, expectedStatus);
  assert.equal(result.bodyText, expectedBodyText);
}

describe("decodeErrorEnvelope: general envelope {error, message}", () => {
  it("decodes every stable code the brief lists, each with its message", () => {
    const codes: string[] = [
      "not_found",
      "bad_request",
      "conflict",
      "internal_error",
      "unauthorized",
      "forbidden",
      "source_instance_unreachable",
      "no_peer_available",
      "no_transcode_capacity",
      "poller_not_running",
    ];
    const statuses: number[] = [404, 400, 409, 500, 401, 403, 502, 503, 503, 503];
    for (let index = 0; index < codes.length; index = index + 1) {
      const code = codes[index];
      const status = statuses[index];
      const message = "human-readable text for " + code;
      const result = decodeErrorEnvelope(status, JSON_CONTENT_TYPE, generalBodyText(code, message));
      assertGeneral(result, status, code, message);
    }
  });

  it("decodes an unrecognised error code (forward compatibility with new server codes)", () => {
    const result = decodeErrorEnvelope(
      500,
      JSON_CONTENT_TYPE,
      generalBodyText("some_future_code_v7", "a code this client has never seen")
    );
    assertGeneral(result, 500, "some_future_code_v7", "a code this client has never seen");
  });

  it("decodes client_upgrade_required as an ORDINARY general envelope when the status is not 426", () => {
    // The brief lists client_upgrade_required among the general envelope's
    // "stable codes seen" too, even though in practice it is only ever sent
    // via the dedicated 426 shape. The status code -- not the string value
    // of `error` -- is what decodeErrorEnvelope must use to pick a shape.
    const result = decodeErrorEnvelope(
      200,
      JSON_CONTENT_TYPE,
      generalBodyText("client_upgrade_required", "server thinks the client is too old")
    );
    assertGeneral(result, 200, "client_upgrade_required", "server thinks the client is too old");
  });

  it("tolerates a charset parameter and mixed case on the Content-Type header", () => {
    const result = decodeErrorEnvelope(404, "Application/JSON; charset=utf-8", generalBodyText("not_found", "gone"));
    assertGeneral(result, 404, "not_found", "gone");
  });

  it("matches the KnownErrorCode union verbatim (compile-time contract check)", () => {
    const knownCodes: KnownErrorCode[] = [
      "not_found",
      "bad_request",
      "conflict",
      "internal_error",
      "unauthorized",
      "forbidden",
      "source_instance_unreachable",
      "no_peer_available",
      "no_transcode_capacity",
      "poller_not_running",
      "client_upgrade_required",
    ];
    assert.equal(knownCodes.length, 11);
  });
});

describe("decodeErrorEnvelope: OAuth-token envelope {error} only, always at 400", () => {
  it("decodes every OAuth error code at status 400 with no message field", () => {
    const codes: OAuthErrorCode[] = [
      "authorization_pending",
      "slow_down",
      "expired_token",
      "access_denied",
      "unsupported_grant_type",
    ];
    for (let index = 0; index < codes.length; index = index + 1) {
      const code = codes[index];
      const result = decodeErrorEnvelope(400, JSON_CONTENT_TYPE, oauthBodyText(code));
      assertOAuth(result, 400, code);
    }
  });

  it("decodes an unrecognised single-field code at 400 as OAuth too (forward compatibility)", () => {
    const result = decodeErrorEnvelope(400, JSON_CONTENT_TYPE, oauthBodyText("some_future_oauth_code"));
    assertOAuth(result, 400, "some_future_oauth_code");
  });

  it("does NOT treat the same one-field body as OAuth when the status is not 400", () => {
    // A one-field {error} body at any status other than 400 is not a
    // recognised shape at all: it is missing the `message` the general
    // envelope requires, and the OAuth shape is pinned to exactly 400.
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, oauthBodyText("authorization_pending"));
    assertMalformed(result, 500, oauthBodyText("authorization_pending"));
  });

  it("falls through to the general envelope for a two-field {error, message} body AT status 400", () => {
    const body = generalBodyText("bad_request", "the request body was invalid");
    const result = decodeErrorEnvelope(400, JSON_CONTENT_TYPE, body);
    assertGeneral(result, 400, "bad_request", "the request body was invalid");
  });
});

describe("decodeErrorEnvelope: dedicated 426 upgrade-required envelope", () => {
  it("decodes the exact shape into UpgradeRequiredEnvelope", () => {
    const result = decodeErrorEnvelope(426, JSON_CONTENT_TYPE, upgradeBodyText("client_upgrade_required", "2.4.0"));
    assertUpgradeRequired(result, "2.4.0");
  });

  it("rejects a 426 body whose error code is not client_upgrade_required", () => {
    const body = upgradeBodyText("bad_request", "2.4.0");
    const result = decodeErrorEnvelope(426, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 426, body);
  });

  it("rejects a 426 body missing minimum_version entirely", () => {
    const body = oauthBodyText("client_upgrade_required");
    const result = decodeErrorEnvelope(426, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 426, body);
  });

  it("rejects a 426 body whose minimum_version is not a string", () => {
    const body = '{"error":"client_upgrade_required","minimum_version":240}';
    const result = decodeErrorEnvelope(426, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 426, body);
  });

  it("never falls back to the general envelope at 426, even with a well-formed {error, message} body", () => {
    // Same status the dedicated shape owns, structurally a valid general
    // envelope (two string fields) -- but 426 must always go through the
    // upgrade-required decoder, which requires minimum_version, not message.
    const body = generalBodyText("internal_error", "something else broke");
    const result = decodeErrorEnvelope(426, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 426, body);
  });
});

describe("decodeErrorEnvelope: a non-JSON Content-Type is rejected before any JSON.parse is attempted", () => {
  it("returns not_json for an HTML body that is not valid JSON (the static-SPA fallback)", () => {
    const body = "<!doctype html><html><head></head><body>Playarr</body></html>";
    const result = decodeErrorEnvelope(200, HTML_CONTENT_TYPE, body);
    assertNotJson(result, 200, HTML_CONTENT_TYPE);
  });

  it("returns not_json for an HTML content-type even when the body text IS valid JSON", () => {
    // The decisive proof that Content-Type gates BEFORE any parse attempt:
    // if decodeErrorEnvelope instead tried JSON.parse first and only fell
    // back to a content-type check on failure, this body would parse clean
    // and come back "general" -- it must not.
    const validJsonBody = generalBodyText("not_found", "this would decode fine as JSON");
    const result = decodeErrorEnvelope(404, HTML_CONTENT_TYPE, validJsonBody);
    assertNotJson(result, 404, HTML_CONTENT_TYPE);
  });

  it("returns not_json when the Content-Type header is absent (null)", () => {
    const result = decodeErrorEnvelope(200, null, "<!doctype html>");
    assertNotJson(result, 200, null);
  });

  it("returns not_json for a plain-text content type", () => {
    const result = decodeErrorEnvelope(500, "text/plain", "internal error, see logs");
    assertNotJson(result, 500, "text/plain");
  });

  it("preserves the exact Content-Type string verbatim, including parameters", () => {
    const result = decodeErrorEnvelope(200, "text/html; charset=utf-8", "<html></html>");
    assertNotJson(result, 200, "text/html; charset=utf-8");
  });

  it("preserves HTTP 200 as the status for the index.html fallback case", () => {
    // The brief calls this out explicitly: an unmatched /api/...-ish path
    // can come back as index.html with HTTP 200, not a 404.
    const result = decodeErrorEnvelope(200, HTML_CONTENT_TYPE, "<!doctype html>");
    assertNotJson(result, 200, HTML_CONTENT_TYPE);
  });
});

describe("decodeErrorEnvelope: malformed JSON-content-typed bodies are a distinct outcome from not_json", () => {
  it("returns malformed for syntactically invalid JSON", () => {
    const body = "{this is not valid json";
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });

  it("returns malformed for a top-level JSON array", () => {
    const body = "[1,2,3]";
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });

  it("returns malformed for a top-level JSON string primitive", () => {
    const body = '"just a string"';
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });

  it("returns malformed for a top-level JSON null", () => {
    const body = "null";
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });

  it("returns malformed for a top-level JSON number", () => {
    const body = "42";
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });

  it("returns malformed for an empty object", () => {
    const body = "{}";
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });

  it("returns malformed when the error field is missing entirely", () => {
    const body = '{"message":"hi"}';
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });

  it("returns malformed when the error field is present but not a string", () => {
    const body = '{"error":404,"message":"hi"}';
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });

  it("returns malformed for a general-shaped body missing message (non-400, non-426 status)", () => {
    const body = oauthBodyText("not_found");
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });

  it("returns malformed when message is present but not a string", () => {
    const body = '{"error":"not_found","message":123}';
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, body);
    assertMalformed(result, 500, body);
  });
});

describe("decodeErrorEnvelope: never throws, whatever it is handed", () => {
  it("does not throw across a batch of adversarial inputs", () => {
    const adversarialInputs: string[] = [
      "",
      "{",
      "}",
      "{{{{{{",
      '{"error":',
      '{"error":"x","message":"y",}',
      " ",
      "a".repeat(10000),
    ];
    for (let index = 0; index < adversarialInputs.length; index = index + 1) {
      const input = adversarialInputs[index];
      assert.doesNotThrow(() => {
        decodeErrorEnvelope(500, JSON_CONTENT_TYPE, input);
      });
      assert.doesNotThrow(() => {
        decodeErrorEnvelope(500, HTML_CONTENT_TYPE, input);
      });
      assert.doesNotThrow(() => {
        decodeErrorEnvelope(500, null, input);
      });
    }
  });

  it("does not throw for an empty body with JSON content-type (also proves it does not crash on empty input)", () => {
    assert.doesNotThrow(() => {
      decodeErrorEnvelope(500, JSON_CONTENT_TYPE, "");
    });
    const result = decodeErrorEnvelope(500, JSON_CONTENT_TYPE, "");
    assertMalformed(result, 500, "");
  });
});
