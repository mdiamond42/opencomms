import { describe, expect, it } from "vitest";
import { canonicalize, ProtocolError } from "../src/index.js";

describe("canonicalize", () => {
  it("orders object keys deterministically", () => {
    expect(canonicalize({ b: 2, a: 1, c: 3 })).toBe('{"a":1,"b":2,"c":3}');
    expect(canonicalize({ c: 3, b: 2, a: 1 })).toBe('{"a":1,"b":2,"c":3}');
  });

  it("sorts nested object keys recursively", () => {
    const left = { z: { beta: 2, alpha: 1 }, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, z: { alpha: 1, beta: 2 } };

    expect(canonicalize(left)).toBe(canonicalize(right));
    expect(canonicalize(left)).toBe('{"a":{"c":3,"d":4},"z":{"alpha":1,"beta":2}}');
  });

  it("preserves array order while canonicalizing object elements", () => {
    expect(canonicalize([{ b: 2, a: 1 }, { a: 1, b: 2 }])).toBe(
      '[{"a":1,"b":2},{"a":1,"b":2}]',
    );
    expect(canonicalize([3, 2, 1])).toBe("[3,2,1]");
  });

  it("rejects non-finite numbers", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => canonicalize(value)).toThrow(ProtocolError);
    }
  });

  it("rejects negative zero", () => {
    expect(() => canonicalize(-0)).toThrow(ProtocolError);
    expect(() => canonicalize({ value: -0 })).toThrow(ProtocolError);
    expect(() => canonicalize([-0])).toThrow(ProtocolError);
  });

  it("rejects arrays with non-index own properties", () => {
    const value = [1] as number[] & { foo?: string };
    value.foo = "bar";

    expect(() => canonicalize(value)).toThrow(ProtocolError);
  });

  it("rejects arrays with own symbol data properties", () => {
    const symbolKey = Symbol("metadata");
    const value = [1] as unknown[] & { [symbolKey]?: string };
    value[symbolKey] = "not canonical";

    expect(() => canonicalize(value)).toThrow(ProtocolError);
  });

  it("rejects arrays with own symbol accessors without invoking getters", () => {
    const symbolKey = Symbol("metadata");
    let getterCalled = false;
    const value = [1];
    Object.defineProperty(value, symbolKey, {
      enumerable: true,
      get() {
        getterCalled = true;
        return "side effect";
      },
    });

    expect(() => canonicalize(value)).toThrow(ProtocolError);
    expect(getterCalled).toBe(false);
  });

  it("rejects accessor own properties without invoking them", () => {
    let objectGetterCalled = false;
    const objectValue = {} as { value: string };
    Object.defineProperty(objectValue, "value", {
      enumerable: true,
      get() {
        objectGetterCalled = true;
        return "side effect";
      },
    });

    expect(() => canonicalize(objectValue)).toThrow(ProtocolError);
    expect(objectGetterCalled).toBe(false);

    let arrayGetterCalled = false;
    const arrayValue = [] as string[];
    Object.defineProperty(arrayValue, "0", {
      enumerable: true,
      get() {
        arrayGetterCalled = true;
        return "side effect";
      },
    });
    arrayValue.length = 1;

    expect(() => canonicalize(arrayValue)).toThrow(ProtocolError);
    expect(arrayGetterCalled).toBe(false);
  });

  it("rejects circular references", () => {
    const objectValue: { self?: unknown } = {};
    objectValue.self = objectValue;

    const arrayValue: unknown[] = [];
    arrayValue.push(arrayValue);

    expect(() => canonicalize(objectValue)).toThrow(ProtocolError);
    expect(() => canonicalize(arrayValue)).toThrow(ProtocolError);
  });

  it("rejects undefined values", () => {
    expect(() => canonicalize(undefined)).toThrow(ProtocolError);
    expect(() => canonicalize({ a: undefined })).toThrow(ProtocolError);
    expect(() => canonicalize([undefined])).toThrow(ProtocolError);
  });

  it("keeps unicode and string escaping stable", () => {
    const value = { text: "hello 🌍 café 漢字", escaped: "line\nbreak\tTabbed\"quote" };

    expect(canonicalize(value)).toBe(JSON.stringify({ escaped: value.escaped, text: value.text }));
    expect(canonicalize(value)).toBe(canonicalize({ escaped: value.escaped, text: value.text }));
  });

  it("rejects unsupported JavaScript types", () => {
    expect(() => canonicalize(() => "nope")).toThrow(ProtocolError);
    expect(() => canonicalize(Symbol("nope"))).toThrow(ProtocolError);
    expect(() => canonicalize(1n)).toThrow(ProtocolError);
    expect(() => canonicalize({ fn: () => "nope" })).toThrow(ProtocolError);
  });
});
