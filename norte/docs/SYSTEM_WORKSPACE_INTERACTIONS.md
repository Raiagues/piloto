# System, Discovery and Project Memory — interaction validation

## System

Children expand/collapse on the current map, keeping siblings visible. Tree arrows and card controls share the same expansion state in both directions. Expand all and Collapse all act on the hierarchy; selecting an explorer item reveals its ancestors. Selecting a card highlights descendants and direct technical interfaces, together with ancestor context; the selected card has a bright uniform outline and stronger fill, related context dims moderately, and unrelated branches dim strongly. Clicking empty canvas clears selection.

The hierarchy toggle lives on its left edge. System no longer has Requirements, Review documents, What if, Element relationships or hierarchy search. Their exclusive UI, source-preview option and What-if-only analysis endpoint have been removed. The shared deterministic impact engine, requirements/evidence data and Discovery scenario inspection remain active.

Containment determines vertical ranks and uses a thin dashed line. Adjacent peer interfaces use side ports; long peer connections detour under intervening cards. Parallel/reverse edges use separate port offsets. Wider gaps reserve room for labels. Uniform one-pixel borders and restrained teal, blue and amber card fills distinguish systems, subsystems and components; scenario verdict colors remain separate.

Cards support dragging, pan/zoom, fit, reset and Alt + arrow keys. Positions persist in `navigation.systemLayouts.architecture`, independently of engineering facts. Historical coordinates from older views are retained in storage but not applied to the new layout. The canvas title uses the current project name rather than the frozen extraction title. Saves are serialized so an older in-flight autosave cannot overwrite a rename during navigation. The browser regression deliberately delays that older save. Default zoom preserves legibility; selecting an offscreen tree item brings it into view, and Fit explicitly shows the entire map.

## Discovery

Conception contains only System and Discovery. The Timeline component, Gantt helpers, styles and tab have been deleted. Old workspace preferences normalize to System.

Discovery starts with New idea. Connection, duplication and deletion controls appear when a card is selected. Saving a new or edited idea automatically asks the configured AI to interpret its text. The result is a short summary or clarification question on the card. Refine idea opens the same text editor; See impact evaluates a resolved proposal. There is no target/property selection form in Discovery and no regex recognition fallback. New and duplicated ideas use free positions without moving existing cards.

`POST /api/system-ai/interpret-hypothesis` receives project ID, hypothesis text and language. The server supplies the saved entity/requirement/property inventory to Gemini, including entity descriptions and parent context so everyday names can be resolved. Interpretation follows the language of the idea, including when it differs from the interface language. Clarifications must ask only for missing context, never internal IDs or property keys; a server-side guard also rejects such technical questions. Explicit absolute mass, power, current, voltage and energy proposals may add a previously missing property to a temporary scenario on an existing target. Relative changes still require a known previous value. A generic payload name is not automatically treated as a camera. It authenticates and authorizes access, requires CSRF, limits requests and rejects results when the architecture changes during interpretation. Raw source documents, canvas coordinates, correction archives and scenario history are excluded.

Interpretation may target an existing entity or requirement, propose a named component replacement, or request clarification. Unknown targets/keys, unsupported unit conversions, invented quoted wording, no-op changes and duplicate updates produce clarification. Relative increments and scaling are computed against current values. Interpretation never changes the baseline or infers physical dependencies. The impact engine evaluates the temporary change when requested.

Stale responses after card edits are ignored; closing the workspace cancels pending browser requests. Interpretation requests have a 30-second deadline and no automatic provider retry. A failed request leaves the idea saved and offers a retry on the card. The browser-only demo explicitly reports that connected AI is required.

## Project Memory

One uppercase title replaces the eyebrow/title/subtitle stack. The introductory team/artifact descriptions and success-readiness message are removed. Incomplete-memory and API-error messages remain functional.

Compact artifact cards use a 108px minimum height. One artifact grid displays linked team references and project documents, with at most four columns and fewer columns on narrow screens. The workspace scrolls vertically so additional rows remain accessible. Team artifacts retain ownership and unlink behavior; project files retain their edit/delete behavior. No documents are deleted by the UI simplification.

Project name is edited under the heading. Open conception / Abrir concepção is at the top right, with Edit memory in the corresponding Conception action area. The reference-program label has additional space above its content. Program synchronization success appears as a dismissible bottom-right toast and disappears after 4.5 seconds; errors retain their existing feedback. Conception also provides Next phase, opening an explicitly identified preliminary-design preview with a return action. That phase remains unlocked after reload; detailed design, integration/verification and operations are still disabled previews.

## Checks

- Quality: client/server tests, typecheck, lint and production build.
- Authenticated browser checks: automatic interpretation, inline clarification without a modal, card operations, two-tab keyboard navigation, uppercase heading, unified artifact grid, mobile scrolling, inline expansion, branch focus, drag persistence, hierarchy toggle and immediate rename/reload. The external provider is simulated with explicit synthetic responses for interaction tests. Additional acceptance replays the recorded real-source Quetzal extractions onto the isolated test baseline, rejects stale pre-extension saves, checks the new overview blocks and memory artifacts, and never reads or mutates the user’s database.
- Quetzal browser checks: the existing positive-margin and continuous-transmission scenarios still work with an explicit provider fixture. This is not an extraction-quality result.
- Dependency audit: zero vulnerabilities. Secret scanning and diff checks pass.

The live command `node --env-file-if-exists=.env.local scripts/acceptance-discovery.mjs` uses only a synthetic architecture and invented Portuguese phrases; it reads no database or Quetzal documents. The first interpretation with the configured `gemini-3.5-flash-lite` did not receive an HTTP response before the 30-second deadline. A separate minimal request also timed out after 15 seconds, while a public HTTPS connectivity check succeeded. The remaining live interpretation cases did not run. Live semantic acceptance therefore remains unconfirmed; simulated browser success is not represented as a live-provider success. This earlier Discovery interpretation result is distinct from the later successful per-document architecture extractions recorded in `examples/quetzal1/architecture-extraction`. No Render deployment was triggered.

On 2026-09-09 the live synthetic acceptance was extended with “mudar peso da camera para 1kg”, an imaging payload described as a camera, no previous mass, and an English interface. The first request to the configured model timed out at 30 seconds without HTTP response; subsequent live cases did not run. The new local regression verifies a 1 kg user-supplied scenario, unchanged baseline, rejection of relative changes without a previous mass and suppression of internal-ID questions. Prompt behavior on the live provider remains unconfirmed for this revision.
