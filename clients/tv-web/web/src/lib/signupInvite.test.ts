import { describe, expect, it } from "vitest";
import { parseSignupInvite } from "./signupInvite";

describe("parseSignupInvite", () => {
  it("reads an encoded Streamarr server and invite token", () => {
    expect(
      parseSignupInvite(
        "?server=https%3A%2F%2Fstreamarr.example.com%2F&invite=one-use-token"
      )
    ).toEqual({
      serverUrl: "https://streamarr.example.com",
      inviteToken: "one-use-token",
    });
  });

  it("allows local HTTP server addresses", () => {
    expect(parseSignupInvite("?server=http%3A%2F%2F192.168.1.20%3A8080&invite=token")).toEqual({
      serverUrl: "http://192.168.1.20:8080",
      inviteToken: "token",
    });
  });

  it("rejects missing values and non-HTTP schemes", () => {
    expect(parseSignupInvite("?server=https%3A%2F%2Fstreamarr.example.com")).toBeNull();
    expect(parseSignupInvite("?server=javascript%3Aalert(1)&invite=token")).toBeNull();
  });
});
