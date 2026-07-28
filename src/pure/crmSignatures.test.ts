import { describe, expect, it } from "vitest";
import { detectCrm } from "./crmSignatures.js";

describe("detectCrm", () => {
  it("detects HubSpot from a hs-scripts fixture", () => {
    const html = `<html><head><script src="https://js.hs-scripts.com/12345.js"></script></head></html>`;
    expect(detectCrm(html)).toEqual({ platform: "HubSpot", matched: "js.hs-scripts.com" });
  });

  it("picks Salesforce first when both pardot and hs-scripts are present", () => {
    const html = `
      <script src="https://pi.pardot.com/pd.js"></script>
      <script src="https://js.hs-scripts.com/12345.js"></script>
    `;
    expect(detectCrm(html)).toEqual({ platform: "Salesforce", matched: "pi.pardot.com" });
  });

  it("returns null platform when nothing matches", () => {
    const html = `<html><body><h1>Just a plain page</h1></body></html>`;
    expect(detectCrm(html)).toEqual({ platform: null, matched: null });
  });

  it("detects Pipedrive", () => {
    const html = `<script src="https://leadbooster-chat.pipedrive.com/assets/loader.js"></script>`;
    expect(detectCrm(html)).toEqual({ platform: "Pipedrive", matched: "leadbooster-chat.pipedrive.com" });
  });

  it("detects Close CRM", () => {
    const html = `<script src="https://app.close.com/widget.js"></script>`;
    expect(detectCrm(html)).toEqual({ platform: "Close CRM", matched: "app.close.com" });
  });

  it("detects Attio", () => {
    const html = `<a href="https://attio.com">powered by</a>`;
    expect(detectCrm(html)).toEqual({ platform: "Attio", matched: "attio.com" });
  });

  it("detects Folk CRM", () => {
    const html = `<img src="https://folk.app/badge.png">`;
    expect(detectCrm(html)).toEqual({ platform: "Folk CRM", matched: "folk.app" });
  });

  it("is case-insensitive", () => {
    const html = `<script src="HTTPS://JS.HS-SCRIPTS.COM/1.js"></script>`;
    expect(detectCrm(html)).toEqual({ platform: "HubSpot", matched: "js.hs-scripts.com" });
  });
});
