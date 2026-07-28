// Deploys an approved follow-up page to Netlify via `npx -y netlify-cli`.
// One HTML file becomes a whole site (index.html in a temp dir). The exec
// seam is injectable so tests never touch the network. NETLIFY_AUTH_TOKEN is
// read from config and passed via env, never logged.

import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { NETLIFY_AUTH_TOKEN } from "./db.js";
import { followupSlug } from "./pure/followup.js";

const execFileP = promisify(execFile);

export type Exec = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: Exec = async (cmd, args) => {
  const { stdout } = await execFileP(cmd, args, {
    env: { ...process.env, NETLIFY_AUTH_TOKEN },
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout };
};

export type DeployOutcome =
  | { dryRun: true; plan: string[] }
  | { dryRun: false; url: string; siteId: string; slug: string };

const MAX_NAME_ATTEMPTS = 5;
const NETLIFY = ["-y", "netlify-cli"];

async function createSite(slug: string, exec: Exec): Promise<{ id: string; url: string }> {
  const { stdout } = await exec("npx", [
    ...NETLIFY,
    "api",
    "createSite",
    "--data",
    JSON.stringify({ name: slug }),
  ]);
  const parsed = JSON.parse(stdout) as { id?: string; ssl_url?: string; url?: string };
  if (!parsed.id) throw new Error("netlify createSite returned no site id");
  return { id: parsed.id, url: parsed.ssl_url ?? parsed.url ?? `https://${slug}.netlify.app` };
}

export async function deployFollowup(
  html: string,
  companyName: string,
  opts: { siteId?: string; dryRun?: boolean } = {},
  exec: Exec = defaultExec
): Promise<DeployOutcome> {
  const baseSlug = followupSlug(companyName);

  if (opts.dryRun) {
    return {
      dryRun: true,
      plan: [
        opts.siteId
          ? `redeploy to existing netlify site ${opts.siteId}`
          : `npx netlify-cli api createSite --data {"name":"${baseSlug}"} (suffix -2..-5 on collision)`,
        `write index.html to a temp dir`,
        `npx netlify-cli deploy --prod --dir <tmp> --site <siteId> --json`,
      ],
    };
  }

  if (!NETLIFY_AUTH_TOKEN && exec === defaultExec) {
    throw new Error("NETLIFY_AUTH_TOKEN is not set in .env (required for deploy; see SETUP.md)");
  }

  let siteId = opts.siteId ?? "";
  let slug = baseSlug;
  let siteUrl = "";

  if (!siteId) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
      slug = followupSlug(companyName, attempt);
      try {
        const site = await createSite(slug, exec);
        siteId = site.id;
        siteUrl = site.url;
        break;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        if (!/name/i.test(message)) throw err; // only collisions retry
      }
    }
    if (!siteId) {
      throw new Error(
        `could not create a netlify site name after ${MAX_NAME_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      );
    }
  }

  const dir = await mkdtemp(join(tmpdir(), "followup-"));
  await writeFile(join(dir, "index.html"), html, "utf8");

  const { stdout } = await exec("npx", [
    ...NETLIFY,
    "deploy",
    "--prod",
    "--dir",
    dir,
    "--site",
    siteId,
    "--json",
  ]);
  const deployed = JSON.parse(stdout) as { url?: string; ssl_url?: string; deploy_url?: string };
  const url = deployed.ssl_url ?? deployed.url ?? siteUrl;
  if (!url) throw new Error("netlify deploy returned no url");

  return { dryRun: false, url, siteId, slug };
}
