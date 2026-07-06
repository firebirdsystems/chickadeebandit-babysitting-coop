// Mirrors the handful of /hub-sdk.js helpers that logic.js depends on, so the
// pure logic can be unit-tested in Node without the browser-only SDK.

export function isAdult(member) {
  return !!member && member.role === "adult";
}

export function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
