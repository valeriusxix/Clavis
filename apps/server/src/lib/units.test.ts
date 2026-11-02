import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits, trimDecimal } from "./units";

describe("units", () => {
  it("converts human <-> base units without floats", () => {
    expect(toBaseUnits("1", 24)).toBe("1000000000000000000000000");
    expect(toBaseUnits("1.5", 6)).toBe("1500000");
    expect(toBaseUnits("0.00000001", 8)).toBe("1");
    expect(toBaseUnits("2.50000000", 6)).toBe("2500000"); // trailing zeros beyond decimals are fine
    expect(fromBaseUnits("1500000000000000000000000", 24)).toBe("1.5");
    expect(fromBaseUnits("1", 8)).toBe("0.00000001");
    expect(fromBaseUnits("0", 6)).toBe("0");
    expect(trimDecimal("1.50000000")).toBe("1.5");
    expect(trimDecimal("3.00000000")).toBe("3");
  });

  it("rejects bad input", () => {
    expect(() => toBaseUnits("0.01e2", 6)).toThrow();
    expect(() => toBaseUnits("0.0000001", 6)).toThrow();
    expect(() => toBaseUnits("-1", 6)).toThrow();
  });
});
