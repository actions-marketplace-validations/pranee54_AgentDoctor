import { describe, expect, it } from "vitest";

import {
  goAdapter,
  parseSourceFile,
  phpAdapter,
  pythonAdapter,
  typescriptAdapter,
} from "../../../src/languages/index.js";

describe("language adapters", () => {
  it("parses TypeScript with compiler AST (not regex)", async () => {
    const src = `
import { x } from "./x";
export function hello(a: number) { return x(a); }
export class Foo {}
`;
    const result = await typescriptAdapter.parse("src/hello.ts", src);
    expect(result.ok).toBe(true);
    expect(result.capabilities.parse).toBe("supported");
    expect(result.symbols.some((s) => s.name === "hello" && s.evidence === "ast")).toBe(true);
    expect(result.imports.some((i) => i.specifier === "./x")).toBe(true);
    expect(result.calls.length).toBeGreaterThan(0);
  });

  it("parses Python via CPython ast when python3 available", async () => {
    const caps = pythonAdapter.capabilities();
    if (caps.parse !== "supported") {
      expect(caps.parse).toBe("unsupported");
      return;
    }
    const src = `
import os
def greet(name):
    return os.path.join(name)
class Box:
    pass
`;
    const result = await pythonAdapter.parse("app.py", src);
    expect(result.ok).toBe(true);
    expect(result.symbols.some((s) => s.name === "greet" && s.evidence === "ast")).toBe(true);
    expect(result.imports.some((i) => i.specifier === "os")).toBe(true);
  });

  it("parses PHP via token_get_all when php available", async () => {
    const caps = phpAdapter.capabilities();
    if (caps.parse !== "supported") {
      expect(caps.parse).toBe("unsupported");
      return;
    }
    const src = `<?php
use App\\Service;
function greet($name) { return Service::run($name); }
class Box {}
`;
    const result = await phpAdapter.parse("app.php", src);
    expect(result.ok).toBe(true);
    expect(result.symbols.some((s) => s.name === "greet" && s.evidence === "ast")).toBe(true);
    expect(result.symbols.some((s) => s.name === "Box")).toBe(true);
    expect(result.imports.some((i) => i.specifier.includes("App"))).toBe(true);
  });

  it("does not fake Go AST when go toolchain missing or extractor absent", async () => {
    const result = await goAdapter.parse("main.go", "package main\nfunc main() {}");
    expect(result.ok).toBe(false);
    expect(result.capabilities.parse).toBe("unsupported");
  });

  it("does not fake Java AST", async () => {
    const result = await parseSourceFile("Main.java", "class Main {}");
    expect(result.ok).toBe(false);
    expect(result.capabilities.parse).toBe("unsupported");
    expect(result.limitations.join(" ")).toMatch(/not bundled|external parser/i);
  });
});
