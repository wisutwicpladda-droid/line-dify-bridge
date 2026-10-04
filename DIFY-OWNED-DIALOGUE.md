# Dify-owned dialogue candidate (2026-10-04)

Not deployed. Production remains unchanged. Branch: codex/dify-owned-dialogue-20261004.
Based on 402e5a3 (the approved image-button candidate), whose deployed base is a714c63. This does not include the paused Recovery worktree.

## Boundary

Dify receives the exact current text and uploaded image plus its native conversation ID. Its existing AI intent/context node, memory, live Sheets, KB, product rules and final model own the answer. The final Dify code validates product references/status and calculates explicitly requested arithmetic before handing over a delivery packet.

Bridge accepts `ladda.line.v1`: `text`, `images` (canonical asset names), `buttons` (canonical names), `handoff` (boolean). Text is forwarded unchanged. Bridge resolves explicit asset references, creates LINE buttons, splits text losslessly for LINE limits, serializes conversations, and prevents stale generation from crossing a human ownership transition. Fixed Dify safety/greeting branches remain plain-text compatible.

Removed from the active answer path: sheet-context enrichment; rate filtering; calculator; phone-line removal; internal-group line deletion; unreleased-product answer rewriting; prose Strategy sorting; compactor; product-name/intent regex image inference; whole-category image interception; outgoing prose callback detection; cached team-answer interception. Legacy utility files remain in Git history/source but are no longer imported by server.js.

Preserved: webhook verification, media upload, LINE reply/push, existing registration/LIFF/POS/CRM/admin data, product data sync/validation, exact rich-menu ownership controls, operator pause/resume, sales roster administration and paginated image buttons. These operational/form paths still contain validation regex and fixed UI messages; this is not a claim that the entire repository is regex-free. Business registration policy is unchanged. Passive CRM extraction cannot alter the Dify query or answer.

The previous soft-registration invitation is no longer appended to an AI answer. Explicit forms and enforced registration continue. Free-text requests for a human are interpreted by Dify; the exact rich-menu ownership command remains deterministic.

Missing image files produce a delivery error message alongside the unchanged AI reply, not a substitute product image. All Dify-requested buttons remain even if an asset is absent. More than 13 buttons use pagination. Requests from those buttons go back to Dify for fresh product-status checks.

## Verification

- `node tests/dify_delivery_check.js`: 11 targeted cases using actual server functions, mocked network only.
- `node tests/product_image_buttons_check.js`: 9 targeted cases, all 95 mapped names/85 files checked, including flex rendering and pagination.
- `node --check server.js`; `git diff --check`.
- Dify-side code, saved draft/export and live Preview evidence are recorded in the nong-ladda project at `recovery/2026-10-04/dify-owned-dialogue/`.
- These checks are not real LINE E2E, concurrency load certification, or Production approval.

## Release and rollback

Do not deploy this branch alone. First review/publish the matching Dify draft with optional `line_channel` input and final delivery node, then deploy this Bridge candidate to the authorized environment. Old Bridge requests have no channel input and receive plain text from the new Dify flow. Until then the current live deployment is unchanged.

Rollback Bridge to deployed a714c63 first, then restore the prior Dify version if needed. Keep credentials and user data in existing secret/state stores. No token or key is part of this patch.

Known limits: three open product names in the 89-row snapshot have no image mapping (แจ๊ส 50 อีซี, นิวเพน, โมเวนทัส); supply verified assets separately. Dify remains probabilistic: prompt rules must still be evaluated for factual claims, rate correctness, concise writing and complete product-ID emission. The transport layer deliberately does not repair those claims. Network deliveries already accepted by LINE cannot be recalled by a later admin claim; ownership is rechecked before generation/delivery and each remaining batch.
