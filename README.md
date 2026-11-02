# ai-speaking-tutor- — Fork Overview

This repository is a GitHub fork of [Tanishams/ai-speaking-tutor-](https://github.com/Tanishams/ai-speaking-tutor-). Keep the upstream attribution and license terms when redistributing or documenting inherited code. This README describes the copy under `Surabin123`; it does not claim authorship of the upstream implementation.

## Current contents

The repository contains a browser-based speaking-practice interface made from HTML, CSS, JavaScript, and image assets. It has no backend service or complete build/test workflow in the inspected root tree. Its source is closely related in structure to the separate `Surabin123/ai-speaking-tutor` repository, so document any fork-specific changes before presenting this as a distinct project.

## Security notice

The public browser JavaScript contained a provider credential; it has been removed from this branch and AI requests are disabled here. Treat the old credential as exposed, revoke it with the provider, and review usage. Do not put a replacement secret in browser code; AI requests need a server-side proxy. The related personal repository had the same class of issue.

## Run

After revoking the old credential, serve static files from the repository root with a local HTTP server. AI requests remain disabled until a protected server-side endpoint is configured. For example:

```powershell
py -m http.server 8000
```

Open `http://localhost:8000` in a modern browser. Media features require local/secure-origin camera and microphone permissions. The AI feature must remain unavailable until a protected server-side request path is configured.

## Tests, deployment, and license

No automated test suite or deployment configuration was found in the inspected tree. The committed `node_modules.zip` dependency archive has been removed from this branch. Review the upstream repository and its license before making or publishing changes. Do not describe this fork as an independently authored project unless its changes and contribution history support that claim.
