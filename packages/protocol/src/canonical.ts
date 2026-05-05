import { ProtocolError } from "./errors.js";

function fail(message: string): never {
  throw new ProtocolError(message, [message]);
}

function isArrayIndexKey(key: string): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key;
}

function rejectAccessors(descriptors: Record<string, PropertyDescriptor>): void {
  for (const descriptor of Object.values(descriptors)) {
    if ("get" in descriptor || "set" in descriptor) {
      fail("Canonical JSON does not support accessor properties");
    }
  }
}

function canonicalizeInner(value: unknown, seen: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }

  const type = typeof value;

  if (type === "string") {
    return JSON.stringify(value);
  }

  if (type === "number") {
    if (!Number.isFinite(value)) {
      fail("Canonical JSON does not support non-finite numbers");
    }
    if (Object.is(value, -0)) {
      fail("Canonical JSON does not support negative zero");
    }
    return JSON.stringify(value);
  }

  if (type === "boolean") {
    return value ? "true" : "false";
  }

  if (type === "undefined") {
    fail("Canonical JSON does not support undefined");
  }

  if (type === "function" || type === "symbol" || type === "bigint") {
    fail(`Canonical JSON does not support ${type}`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      fail("Canonical JSON does not support circular references");
    }
    seen.add(value);

    const symbolKeys = Object.getOwnPropertySymbols(value);
    if (symbolKeys.length > 0) {
      fail("Canonical JSON does not support symbol keys");
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    rejectAccessors(descriptors);

    for (const key of Object.keys(descriptors)) {
      if (key !== "length" && !isArrayIndexKey(key)) {
        fail("Canonical JSON does not support non-index array properties");
      }
    }

    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        fail("Canonical JSON does not support sparse arrays");
      }
      items.push(canonicalizeInner(value[index], seen));
    }
    seen.delete(value);
    return `[${items.join(",")}]`;
  }

  if (type === "object") {
    const objectValue = value as object;

    if (seen.has(objectValue)) {
      fail("Canonical JSON does not support circular references");
    }
    seen.add(objectValue);

    const prototype = Object.getPrototypeOf(objectValue);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("Canonical JSON only supports plain objects");
    }

    const symbolKeys = Object.getOwnPropertySymbols(objectValue);
    if (symbolKeys.length > 0) {
      fail("Canonical JSON does not support symbol keys");
    }

    const descriptors = Object.getOwnPropertyDescriptors(objectValue);
    rejectAccessors(descriptors);

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeInner(record[key], seen)}`);

    seen.delete(objectValue);
    return `{${entries.join(",")}}`;
  }

  fail(`Canonical JSON does not support ${type}`);
}

export function canonicalize(value: unknown): string {
  return canonicalizeInner(value, new WeakSet<object>());
}
