import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { ServerError, serverError, thrownOf } from "./serverError";

describe("thrownOf", () => {
  it("makes a typed failure a server error with its message, and keeps a defect as it is", () => {
    const failed = thrownOf(Cause.fail(new Error("Thread not found")));
    expect(failed).toBeInstanceOf(ServerError);
    expect((failed as ServerError).message).toBe("Thread not found");
    expect(thrownOf(Cause.fail({ _tag: "Gone" }))).toBeInstanceOf(ServerError);

    const bug = new TypeError("x is undefined");
    expect(thrownOf(Cause.die(bug))).toBe(bug);
  });
});

describe("serverError", () => {
  it("returns a server error and rethrows anything else", () => {
    const refused = new ServerError("no");
    expect(serverError(refused)).toBe(refused);
    expect(() => serverError(new TypeError("bug"))).toThrow(TypeError);
  });
});
