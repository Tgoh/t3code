import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { isServerError, serverError, serverFailure, thrownOf } from "./serverError";

describe("thrownOf", () => {
  it("makes a typed failure a server error with its message, and keeps a defect as it is", () => {
    const failed = thrownOf(Cause.fail(new Error("Thread not found")));
    expect(isServerError(failed)).toBe(true);
    expect((failed as Error).message).toBe("Thread not found");
    expect(isServerError(thrownOf(Cause.fail({ _tag: "Gone" })))).toBe(true);

    const bug = new TypeError("x is undefined");
    expect(thrownOf(Cause.die(bug))).toBe(bug);
  });
});

describe("serverError", () => {
  it("returns a server error, a copy treflex rebuilt from one included, and rethrows anything else", () => {
    const refused = serverFailure("no");
    expect(Object.getPrototypeOf(refused)).toBe(Error.prototype);
    expect(serverError(refused)).toBe(refused);
    const copy = Object.assign(new Error("no"), { name: "ServerError" });
    expect(serverError(copy)).toBe(copy);
    expect(() => serverError(new TypeError("bug"))).toThrow(TypeError);
    expect(() => serverError({ name: "ServerError", message: "no" })).toThrow();
  });
});
