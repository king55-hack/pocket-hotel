import { describe, expect, it } from "vitest";
import { buildMime } from "../src/mail";
import { otpEmail } from "../src/otpEmail";

const decode = (s: string) => Buffer.from(s.replace(/\r\n/g, ""), "base64").toString("utf8");

describe("sign-in code email", () => {
  const e = otpEmail("482915", "https://app.example");
  it("shows the code big, in the subject, with the links and the ignore note", () => {
    expect(e.subject).toContain("482915");
    expect(e.html).toContain(">482915<");
    expect(e.html).toContain("https://app.example");
    expect(e.html).toContain("github.com/king55-hack/pocket-hotel");
    expect(e.html).toContain("user-select:all");
    expect(e.html).toContain("contact the admin");
    expect(e.text).toContain("482915");
    expect(e.text).toContain("admin");
  });
  it("is built as text + HTML alternatives that decode back exactly", () => {
    const raw = buildMime({ from: "Me <me@example.com>", to: "you@example.com", subject: e.subject, text: e.text, html: e.html });
    expect(raw).toContain("multipart/alternative");
    expect(raw).toContain("Content-Type: text/html; charset=UTF-8");
    const html = raw.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split("\r\n--")[0];
    expect(decode(html)).toBe(e.html);
  });
  it("plain messages stay plain, and a header cannot be injected through the subject", () => {
    const plain = buildMime({ from: "me@example.com", to: "you@example.com", subject: "hi", text: "hello" });
    expect(plain).not.toContain("multipart/alternative");
    const evil = buildMime({ from: "me@example.com", to: "you@example.com", subject: "x\r\nBcc: bad@example.com", text: "t" });
    expect(evil).not.toMatch(/\r\nBcc:/);
  });
});
