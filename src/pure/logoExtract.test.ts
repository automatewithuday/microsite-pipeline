import { describe, expect, it } from "vitest";
import { extractAnyLogoImg, extractHeaderLogoImg, extractOgImage, selectBrandfetchLogo,
  selectBrandfetchLogoByTheme,
} from "./logoExtract.js";

describe("extractOgImage", () => {
  it("extracts og:image content", () => {
    const html = `<head><meta property="og:image" content="https://acme.com/og.png" /></head>`;
    expect(extractOgImage(html)).toBe("https://acme.com/og.png");
  });

  it("returns null when absent", () => {
    expect(extractOgImage("<head></head>")).toBeNull();
  });

  it("handles attribute order content-before-property", () => {
    const html = `<meta content="https://acme.com/og2.png" property="og:image">`;
    expect(extractOgImage(html)).toBe("https://acme.com/og2.png");
  });
});

describe("extractHeaderLogoImg", () => {
  it("finds a header img with 'logo' in the src", () => {
    const html = `<header><img src="https://acme.com/assets/logo.svg" alt="Acme"></header>`;
    expect(extractHeaderLogoImg(html)).toBe("https://acme.com/assets/logo.svg");
  });

  it("finds a header img with 'logo' in the alt text", () => {
    const html = `<header><img src="https://acme.com/assets/mark.png" alt="Acme logo"></header>`;
    expect(extractHeaderLogoImg(html)).toBe("https://acme.com/assets/mark.png");
  });

  it("returns null when no header img matches", () => {
    const html = `<header><img src="https://acme.com/assets/hero.png" alt="hero"></header>`;
    expect(extractHeaderLogoImg(html)).toBeNull();
  });

  it("ignores logo imgs outside a header/nav", () => {
    const html = `<footer><img src="https://acme.com/assets/logo.svg" alt="Acme"></footer>`;
    expect(extractHeaderLogoImg(html)).toBeNull();
  });
});

describe("extractAnyLogoImg", () => {
  it("finds a logo img anywhere on the page, not just header/nav", () => {
    const html = `<footer><div><img src="https://acme.com/brand/logo.png" alt="logo"></div></footer>`;
    expect(extractAnyLogoImg(html)).toBe("https://acme.com/brand/logo.png");
  });

  it("returns null when no img matches", () => {
    expect(extractAnyLogoImg(`<img src="https://acme.com/hero.png" alt="hero">`)).toBeNull();
  });
});

describe("selectBrandfetchLogo (Brandfetch v2 logos[].formats[] shape)", () => {
  const logo = (over: Partial<Record<string, unknown>>, formats?: Record<string, unknown>[]) => ({
    type: "logo",
    theme: "dark",
    formats: formats ?? [{ src: "https://cdn.brandfetch.io/x.svg", format: "svg" }],
    ...over,
  });

  it("prefers a full wordmark logo over an icon", () => {
    const logos = [logo({ type: "icon" }), logo({ type: "logo" })];
    const result = selectBrandfetchLogo(logos);
    expect(result?.variant).toBe("logo");
  });

  it("prefers the dark-on-light (theme 'dark') variant over 'light'", () => {
    const logos = [logo({ type: "logo", theme: "light" }), logo({ type: "logo", theme: "dark" })];
    const result = selectBrandfetchLogo(logos);
    expect(result?.theme).toBe("dark");
  });

  it("prefers svg over png over webp over jpg within one logo's formats", () => {
    const logos = [
      logo({ type: "logo", theme: "dark" }, [
        { src: "https://cdn.brandfetch.io/x.jpg", format: "jpg" },
        { src: "https://cdn.brandfetch.io/x.png", format: "png" },
        { src: "https://cdn.brandfetch.io/x.svg", format: "svg" },
      ]),
    ];
    const result = selectBrandfetchLogo(logos);
    expect(result?.format).toBe("svg");
    expect(result?.url).toBe("https://cdn.brandfetch.io/x.svg");
  });

  it("returns null on an empty logos list", () => {
    expect(selectBrandfetchLogo([])).toBeNull();
  });

  it("returns null when logos exist but none has a usable formats[].src", () => {
    expect(selectBrandfetchLogo([{ type: "logo", theme: "dark", formats: [] }])).toBeNull();
  });
});

describe("selectBrandfetchLogoByTheme", () => {
  const logos = [
    { type: "logo", theme: "dark", formats: [{ src: "https://cdn.bf/dark-logo.svg", format: "svg" }] },
    { type: "logo", theme: "light", formats: [{ src: "https://cdn.bf/light-logo.png", format: "png" }, { src: "https://cdn.bf/light-logo.svg", format: "svg" }] },
    { type: "icon", theme: "dark", formats: [{ src: "https://cdn.bf/dark-icon.svg", format: "svg" }] },
  ];

  it("returns the best candidate per theme (wordmark over icon, svg over png)", () => {
    const byTheme = selectBrandfetchLogoByTheme(logos);
    expect(byTheme.dark?.url).toBe("https://cdn.bf/dark-logo.svg");
    expect(byTheme.light?.url).toBe("https://cdn.bf/light-logo.svg");
  });

  it("returns null for a theme with no candidates", () => {
    const byTheme = selectBrandfetchLogoByTheme([logos[0]!]);
    expect(byTheme.dark?.url).toBe("https://cdn.bf/dark-logo.svg");
    expect(byTheme.light).toBeNull();
  });

  it("returns both null on an empty list", () => {
    expect(selectBrandfetchLogoByTheme([])).toEqual({ dark: null, light: null });
  });
});
