# Product image buttons — 4 October 2026

Prepared on `codex/product-image-buttons-20261004` from the deployed Bridge source
`a714c6312370cbd85b3fe0d4ccb1a2f4621a96a4`. Candidate health version: `3.28.1`.

Every recognized product in a normal answer now has a quick-reply image button,
even when its image was already sent or is attached in this answer. Automatic
image deduplication is unchanged. Names pointing to the same image remain
deduplicated in the recommendation menu.

Up to 13 products fit on one page. Longer lists show 12 products and a navigation
button. Navigation cycles through the complete recommendation. Tapping an image
retains the current menu; a new normal answer replaces it. Explicit image taps
continue to use the exact image mapping without calling Dify. The new menu state
is serializable within the existing session and needs no database migration.

Files changed:

- `server.js`: retain all image buttons; attach/reuse session menu; health version.
- `product_image_buttons.js`: LINE quick-reply pagination only.
- `package.json`: focused test command.
- `tests/product_image_buttons_check.js`: isolated execution of the actual image handlers.

Run `npm run test:product-image-buttons` (Node 18+). The focused run passed 14
cases, exercising all 95 catalog names / 85 unique image files. All mapped image
files exist. `node tests/unreleased_guard_check.js` also passed. Syntax and diff
checks passed. These are local tests, not LINE network or client E2E evidence.

No Dify, product mapping, rate/status/Strategy guard, CRM, registration, human
handoff, webhook, credential, or model change. The earlier Recovery WIP is not
part of this branch. This patch does not change which product mentions are
detected or create images for products missing an image mapping.

Deployment is pending owner approval. The earlier App B #60 publication approval
did not deploy this Bridge change. After scoped approval, deploy this exact
isolated branch/commit, verify health `3.28.1`, and check the Karisma/Mablic buttons
through the authorized LINE test account, including a repeat image tap.

Rollback: restore the prior Bridge deployment/source `a714c63` (health `3.28`).
The old code ignores the additional `pimgMenu` session field. No data or secret
rollback is required. App B #60 and the existing webhook remain unchanged.

LINE's documented quick-reply limit is 13 items:
https://developers.line.biz/en/docs/messaging-api/using-quick-reply/
