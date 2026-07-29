# Security Policy

## Reporting a vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/automatewithuday/microsite-pipeline/security/advisories/new) rather than opening a public issue.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get an acknowledgement within a few days.

## How this tool handles your keys

This is a **bring-your-own-key** tool that runs entirely on your machine.

- Your API keys are read from `.env` and used only to call the provider you configured them for.
- Nothing is sent to any server operated by this project. There is no telemetry and no phone-home.
- `.env` is gitignored. `.env.example` ships with empty placeholders and must never be filled in with real values.
- Keys are never written to logs or committed artifacts. Runs log provider names and costs, not credentials.

## Keeping your keys safe

- Keep secrets in `.env` only — don't paste them into issues, pull requests, or commit messages.
- If you accidentally commit a key, **revoke it at the provider immediately**. Rewriting git history does not make an exposed key safe; the only fix is rotation.
- Scope keys down where the provider allows it, and set spend limits on paid APIs.

## Scope

The pipeline sends company data to whichever third-party providers you enable (Anthropic, Deepline, Apify, Firecrawl, Brandfetch, Parallel, Perplexity). Each provider's own terms and privacy policy govern that data. Enable only what you're comfortable sharing, and note that scraped data about real people may carry obligations under GDPR, CCPA, or similar regulations depending on your jurisdiction and use.
