/** Pure helpers for password show/hide controls (login and future forms). */

export function passwordInputType(visible: boolean): "text" | "password" {
  return visible ? "text" : "password";
}

export function passwordVisibilityToggleLabel(visible: boolean): "Hide password" | "Show password" {
  return visible ? "Hide password" : "Show password";
}

export function nextPasswordVisible(visible: boolean): boolean {
  return !visible;
}
