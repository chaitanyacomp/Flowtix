import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  nextPasswordVisible,
  passwordInputType,
  passwordVisibilityToggleLabel,
} from "../../src/lib/passwordVisibility";
import { PasswordInput } from "../../src/components/ui/PasswordInput";

describe("passwordVisibility helpers", () => {
  it("defaults to hidden password input type", () => {
    expect(passwordInputType(false)).toBe("password");
    expect(passwordInputType(true)).toBe("text");
  });

  it("toggles accessible labels between Show and Hide", () => {
    expect(passwordVisibilityToggleLabel(false)).toBe("Show password");
    expect(passwordVisibilityToggleLabel(true)).toBe("Hide password");
  });

  it("flips visibility state without side effects", () => {
    expect(nextPasswordVisible(false)).toBe(true);
    expect(nextPasswordVisible(true)).toBe(false);
  });
});

describe("PasswordInput", () => {
  it("renders password type and Show password control by default", () => {
    const html = renderToStaticMarkup(
      createElement(PasswordInput, {
        id: "login-password",
        value: "secret-value",
        onChange: () => undefined,
        autoComplete: "current-password",
      }),
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('value="secret-value"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("password-visibility-toggle");
    // Must not use a submit control for the eye toggle.
    expect(html).not.toMatch(/type="submit"/);
  });
});
