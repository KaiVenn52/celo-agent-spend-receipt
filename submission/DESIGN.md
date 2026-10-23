# v0.2 design decision and visual QA

The first version used a marketing hero, two large cards and a three-column explanation block. The v0.2 workspace replaces that structure with a navigation rail, one horizontal task composer, a result table and a narrow payment-receipt inspector.

Direction: a calm payment operations workspace. Comfortable density; charcoal rail, cool paper background and white task surfaces. Pale lime identifies the product; green and amber only distinguish payment states. Georgia is limited to the title, while app text and money use the system sans and monospace families.

The complete code-native layout is the design specification. No AI-generated concept or raster UI is used, following the workspace rule that AI imagery needs an explicit user request. The screenshots are actual rendered product evidence, not fabricated provider receipts.

Inspected comparisons against the previous version:

- Copy: removed the oversized promotional headline; the task title and action lead.
- Layout: task history, result and receipt have distinct roles; no repeated feature grid.
- Typography: one serif title with restrained sizes, compact controls, monospace amounts.
- Color: one identity accent, semantic states, no decorative gradient.
- Evidence: visible payment fields replace JSON as the primary surface; raw data remains available.
- Mobile: tasks move to a compact selector and the repeated operation column collapses, preserving cost/status.
- States: empty, success, budget refusal, uncertain hold, unsigned review and verified-payment state are implemented; the last is tested only with injected settlement evidence until a real signature is approved.

See assets/ui-qa.json and the workspace screenshots for rendered checks at 1440/1280, 768 and 375 pixels. A code-first redesign has no image-concept fidelity claim. No assertion that the owner approved this visual direction is implied.
