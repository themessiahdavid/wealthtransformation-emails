import { describe, it, expect } from "vitest";
import { renderFallback, renderSubject } from "../email/templates.js";

describe("renderFallback", () => {
  it("substitutes simple {{var}} placeholders", () => {
    expect(renderFallback("hi {{name}}", { name: "Alice" })).toBe("hi Alice");
  });

  it("supports nested paths", () => {
    expect(renderFallback("{{user.name}}", { user: { name: "Bob" } })).toBe("Bob");
  });

  it("renders empty string for missing keys", () => {
    expect(renderFallback("{{missing}}", {})).toBe("");
  });

  it("handles repeated tokens", () => {
    expect(renderFallback("{{x}} and {{x}}", { x: "a" })).toBe("a and a");
  });

  it("handles whitespace inside braces", () => {
    expect(renderFallback("{{ name }}", { name: "C" })).toBe("C");
  });

  it("renderSubject delegates to renderFallback", () => {
    expect(renderSubject("Hi {{n}}", { n: "Z" })).toBe("Hi Z");
  });

  it("does not interpret HTML", () => {
    expect(renderFallback("{{x}}", { x: "<script>" })).toBe("<script>");
  });
});
