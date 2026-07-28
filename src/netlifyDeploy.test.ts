import { describe, expect, it, vi } from "vitest";
import { deployFollowup, type Exec } from "./netlifyDeploy.js";

const html = "<!doctype html><title>t</title>";

describe("deployFollowup", () => {
  it("dry run returns the plan without executing anything", async () => {
    const exec = vi.fn();
    const out = await deployFollowup(html, "Acme Inc", { dryRun: true }, exec as unknown as Exec);
    expect(out.dryRun).toBe(true);
    if (out.dryRun) {
      expect(out.plan.join("\n")).toContain("acme-inc-growth-plan");
      expect(out.plan.join("\n")).toContain("netlify");
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it("creates a site then deploys, returning the live URL", async () => {
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("createSite")) {
        return {
          stdout: JSON.stringify({ id: "site-123", ssl_url: "https://acme-inc-growth-plan.netlify.app" }),
        };
      }
      return {
        stdout: JSON.stringify({
          deploy_url: "https://deploy.netlify.app",
          url: "https://acme-inc-growth-plan.netlify.app",
        }),
      };
    });
    const out = await deployFollowup(html, "Acme Inc", {}, exec as unknown as Exec);
    expect(out.dryRun).toBe(false);
    if (!out.dryRun) {
      expect(out.siteId).toBe("site-123");
      expect(out.slug).toBe("acme-inc-growth-plan");
      expect(out.url).toBe("https://acme-inc-growth-plan.netlify.app");
    }
  });

  it("retries with a numeric suffix when the site name is taken", async () => {
    let creates = 0;
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("createSite")) {
        creates++;
        if (creates === 1) throw new Error("422: name already taken");
        return {
          stdout: JSON.stringify({ id: "site-456", ssl_url: "https://acme-growth-plan-2.netlify.app" }),
        };
      }
      return { stdout: JSON.stringify({ url: "https://acme-growth-plan-2.netlify.app" }) };
    });
    const out = await deployFollowup(html, "Acme", {}, exec as unknown as Exec);
    if (!out.dryRun) expect(out.slug).toBe("acme-growth-plan-2");
  });

  it("skips site creation when siteId is provided (redeploy keeps the URL)", async () => {
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      expect(args).not.toContain("createSite");
      return { stdout: JSON.stringify({ url: "https://existing.netlify.app" }) };
    });
    const out = await deployFollowup(html, "Acme", { siteId: "site-existing" }, exec as unknown as Exec);
    if (!out.dryRun) expect(out.siteId).toBe("site-existing");
  });

  it("gives up after 5 name collisions", async () => {
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes("createSite")) throw new Error("422: name already taken");
      return { stdout: "{}" };
    });
    await expect(deployFollowup(html, "Acme", {}, exec as unknown as Exec)).rejects.toThrow(/name/i);
  });
});
