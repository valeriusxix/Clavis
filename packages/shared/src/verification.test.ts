import { describe, expect, it } from "vitest";
import { verificationContract } from "./verification";

describe("verificationContract (AUDIT H3)", () => {
  it("a contract pinned in the web build wins over what the server reports", () => {
    expect(verificationContract("clavis-app.testnet", "evil.testnet")).toEqual({
      contractId: "clavis-app.testnet",
      mismatch: "The server reports contract evil.testnet, but this app is pinned to clavis-app.testnet.",
    });
  });
  it("a server that hides the contract can't skip the on-chain check", () => {
    expect(verificationContract("clavis-app.testnet", null)).toEqual({ contractId: "clavis-app.testnet", mismatch: null });
  });
  it("without a pinned contract, the server's is used (local demo); none means skipped", () => {
    expect(verificationContract("", "clavis-app.testnet")).toEqual({ contractId: "clavis-app.testnet", mismatch: null });
    expect(verificationContract(undefined, null)).toEqual({ contractId: null, mismatch: null });
    expect(verificationContract("clavis-app.testnet", "clavis-app.testnet")).toEqual({ contractId: "clavis-app.testnet", mismatch: null });
  });
});
