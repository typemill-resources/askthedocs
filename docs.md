# Ask the Docs — Developer Documentation

## Overview

Ask the Docs is a Typemill plugin that adds an AI-powered Q&A widget to the frontend. Visitors can ask questions about the documentation; the plugin navigates the content tree, reads relevant pages, and returns an answer with sources.

It integrates with Typemill via:

- A **shortcode** (`[:askthedocs:]`) for the visual editor
- **Slim routes** for public and admin APIs
- **Event listeners** for Twig assets, admin navigation, and content-change hooks

---

## File Structure

```
/plugins/askthedocs/
├── askthedocs.php              # Plugin bootstrap, event subscriptions, shortcode renderer
├── askthedocs.yaml             # Plugin manifest + settings definitions
├── AskTheDocsController.php    # All HTTP endpoints and business logic
├── templates/
│   ├── widget.twig             # Frontend chat widget markup
│   └── admin.twig              # Admin dashboard markup
├── css/
│   └── askthedocs.css          # Widget styles
└── js/
    ├── askthedocs.js           # Frontend widget behaviour (plain JS, no build step)
    └── admin.js                # Admin dashboard behaviour
```

---

## Typemill Integration

### Events (`askthedocs.php`)

| Event | Purpose |
|-------|---------|
| `onShortcodeFound` | Registers `[:askthedocs:]` in the visual editor and renders the widget Twig template |
| `onTwigLoaded` | Injects widget CSS/JS on every frontend page |
| `onSystemnaviLoaded` | Adds the "Ask the Docs" admin menu item |
| `onPageReady` | Renders `admin.twig` inside the system shell when visiting `/tm/askthedocs` |
| `onPagePublished` / `onPageDeleted` / `onCacheUpdated` | Triggers auto-reindex if enabled |

### Routes (`addNewRoutes()`)

| Method | Route | Controller method | Auth |
|--------|-------|-------------------|------|
| `POST` | `/api/v1/askthedocs/ask` | `ask` | **Public** |
| `POST` | `/api/v1/askthedocs/reindex` | `reindex` | Admin (system/view) |
| `GET`  | `/api/v1/askthedocs/status` | `status` | Admin |
| `POST` | `/api/v1/askthedocs/summary` | `updateSummary` | Admin |
| `POST` | `/api/v1/askthedocs/generate-summary` | `generateSummary` | Admin |
| `POST` | `/api/v1/askthedocs/questions/clear` | `clearQuestions` | Admin |
| `GET`  | `/api/v1/askthedocs/questions` | `getQuestions` | Admin |
| `GET`  | `/api/v1/askthedocs/logs` | `listSessionLogs` | Admin |
| `POST` | `/api/v1/askthedocs/logs/delete` | `deleteSessionLog` | Admin |
| `POST` | `/api/v1/askthedocs/log` | `getSessionLog` | Admin |
| `GET`  | `/tm/askthedocs` | System blank page | Admin |

---

## Request Lifecycle

### 1. Frontend Widget

1. **Twig** (`widget.twig`) renders the widget container, form, and configurable settings (title, colours, placeholder, explanation text).
2. **CSS** (`askthedocs.css`) styles the widget. No rounded borders; neutral dark-grey palette by default.
3. **JS** (`askthedocs.js`) handles:
   - Submitting questions via `fetch()`
   - Displaying user bubbles (plain text) and assistant bubbles (rendered Markdown)
   - Showing a CSS-animated spinner while waiting for the AI
   - Hiding the initial explanation text on first interaction
   - Privacy consent checkbox validation (optional, controlled by admin setting)

The widget uses a lightweight inline Markdown parser (`mdToHtml()`) so assistant answers are formatted without an external dependency.

#### Privacy Consent (optional)

When `privacy_check` is enabled in the plugin settings:
- `widget.twig` renders a checkbox with the configured `privacy_label` (raw HTML allowed, so links to a privacy page work)
- The JS stores the visitor's choice in a cookie named `askthedocs_privacy` (1 year, path `/`)
- On every submit, the JS checks the checkbox. If unchecked, it displays the `privacy_error` message inline (red banner below the checkbox) and stops the submission
- The visitor can check or uncheck the box at any time; unchecking deletes the cookie

### 2. Public API (`ask`)

`AskTheDocsController::ask()` is the entry point. It runs through a hardening pipeline **before** any AI call:

1. **Raw line-count check** — rejects questions with too many newlines (fake multi-turn prompts)
2. **Input sanitization** — `sanitizeInput()` strips tags, null bytes, control chars, normalizes Unicode (NFKC), and collapses whitespace
3. **History sanitization** — `sanitizeHistory()` drops malformed history entries and scrubs their contents
4. **Length limit** — hard cap of 500 characters
5. **Prompt-injection guard** — `detectPromptInjection()` blocks ~60 patterns (jailbreak phrases, raw JSON/XML wrappers, separator headers, Unicode bidi overrides, obfuscation tricks)
6. **Usage limits** — per-visitor, per-day, per-minute, and per-token budgets (see below)
7. **Navigation build** — constructs a two-level index of published pages + summaries
8. **Agent loop** — iteratively asks the AI to navigate, read pages, and answer
9. **Optional session logging** — full Markdown session log per question
10. **Usage tracking** — increments counters server-side

### 3. Agent Loop (`agentLoop()`)

The controller sends the AI a **system prompt** that:
- Forbids role changes, instruction overrides, code execution, and off-topic answers
- Mandates raw JSON output (no markdown fences, no XML)
- Defines three actions: `open_folder`, `open_page`, `answer`

For each step:
1. The AI receives the question + current navigation context
2. It returns a JSON action
3. The controller executes it (folder listing, page content fetch, or final answer)
4. The conversation history grows and is fed back to the AI

Loop limits (configurable):
- `max_steps` — total iterations (default 6)
- `max_pages` — how many pages the AI may read (default 3)

If the loop hits a limit, the controller injects a force-answer instruction.

### 4. AI Adapter

`AskTheDocsController` uses `Typemill\Models\AiAdapter` (the same adapter the rest of Typemill uses). It reads:

- `ai_adapter` / `ai_base_url` / `ai_model` / `ai_api_key` from system settings
- Falls back to legacy `chatgpt` / `claude` service settings for backwards compatibility

---

## Security Architecture

### Input Hardening

| Layer | What it does |
|-------|--------------|
| `strip_tags()` | Removes HTML/PHP tags |
| Null-byte removal | Prevents string-termination tricks (`\x00`) |
| Control-char stripping | Removes non-printable chars except `\t`, `\n`, `\r` |
| Unicode NFKC normalization | Collapses homoglyphs / confusable characters |
| Whitespace collapse | Prevents visual-padding attacks |
| Line-count guard | Rejects fake multi-turn conversation blocks |
| Length cap | 500 characters max |

### Prompt-Injection Detection

`detectPromptInjection()` scans for:
- Classic jailbreak phrases (*ignore previous*, *DAN mode*, *developer mode*, *act as…*)
- Role-separator headers (`### instruction`, `--- system`, `*** role`, `+++ assistant`)
- Raw JSON/XML wrapper attempts (`<system>`, `{"role":`, `<function_calls>`)
- Encoding obfuscation (`&#x3c;`, `base64,`, `rot13`, `hex encode`)
- Code-execution markers (`eval(`, `exec(`, `php://`, `data://`)
- Unicode bidirectional override characters (U+202A–U+202E, U+2066–U+2069)
- Regex heuristic: starts with `[`, `{`, or `<` and ends with `]`, `}`, or `>`

If triggered, the controller returns a safe fallback answer immediately — **no AI call is made**.

### Usage Limits (Server-Side)

All limits are stored in `/data/askthedocs/usage.json` and keyed by calendar day. They reset automatically at midnight.

| Limit | Setting key | Default | Scope |
|-------|-------------|---------|-------|
| Per visitor per day | `max_questions_per_session` | 3 | Hashed IP + User-Agent |
| Global per day | `max_questions_per_day` | 100 | All visitors combined |
| Global tokens per day | `max_tokens_per_day` | 50 000 | Approximate budget |
| Burst per minute | `max_questions_per_minute` | 5 | Per visitor |
| Lines per question | `max_lines_per_question` | 5 | Single question |

The visitor hash is `substr(sha256(IP + '|' + UA), 0, 16)`. Clearing cookies or switching to incognito **does not** reset the counter because the server derives the identity from the request headers.

Token estimation uses a rough heuristic (`strlen / 4 + overhead`). The pre-check runs **before** the AI call to avoid overspending.

---

## Data Storage

All data lives under `/data/askthedocs/` (created on first write via `StorageWrapper`).

| File | Purpose | Format |
|------|---------|--------|
| `summaries.json` | Page titles + summaries for the navigation index | JSON |
| `usage.json` | Daily usage counters (global + per-visitor) | JSON |
| `log_YYYYMMDD_HHMMSS.md` | Optional full session logs (system prompt, AI raw responses, navigation steps) | Markdown |

**Retention**
- Session markdown logs are never auto-deleted; they must be cleaned manually from `/data/askthedocs/`

---

## Admin Dashboard

### Twig Template (`admin.twig`)

Rendered inside the Typemill system shell (`/tm/askthedocs`). Contains a single Vue mount point.

### Admin JS (`admin.js`)

Vue Options API, no build step. Two tabs:

#### Summaries
- **Index status bar** — last build date, page count, "Rebuild & Generate" button, "Generate All Missing" button
- **Progress bar** — appears during bulk AI generation, shows current/total count and a Stop button
- **Card grid** — one card per page with title, URL, editable summary textarea, Save button, and per-page Generate AI button
- New pages are indexed with an empty summary so missing entries are visible
- "Rebuild & Generate" rebuilds the index then generates AI summaries for all empty entries
- "Generate All Missing" only generates AI summaries for currently empty entries

#### Questions
- Questions are extracted on demand from `log_*.md` session files via regex (`**Question:** …`)
- Table shows date + question text
- **View log** button opens a modal that fetches the full Markdown session log via `POST /api/v1/askthedocs/log`
- **Delete All Logs** removes all `log_*.md` files (and therefore the question table too)

### Admin API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/askthedocs/reindex` | Rebuilds the summary index. Leaves existing summaries untouched; new pages are added with empty summaries |
| `GET /api/v1/askthedocs/status` | Returns `built`, `pagecount`, and the full `summaries` array |
| `POST /api/v1/askthedocs/summary` | Saves a single summary by path |
| `POST /api/v1/askthedocs/generate-summary` | Calls the AI to generate a summary from live page content (first 2000 chars) |
| `GET /api/v1/askthedocs/questions` | Parses all `log_*.md` files and returns `{date, question, logfile}` entries |
| `POST /api/v1/askthedocs/questions/clear` | Deletes all `log_*.md` files |
| `POST /api/v1/askthedocs/log` | Reads a single session log file by filename |

---

## Configuration / Settings

All settings are defined in `askthedocs.yaml` under `settings:` and rendered in the Typemill plugin settings UI.

| Setting | Type | Default | Purpose |
|---------|------|---------|---------|
| `widget_title` | text | Ask the Docs | Widget heading |
| `widget_button_label` | text | Ask | Submit button text |
| `widget_placeholder` | text | Ask a question… | Textarea placeholder |
| `widget_button_color` | color | `#333333` | Button background |
| `widget_button_text_color` | color | `#ffffff` | Button text |
| `widget_bg_color` | color | `#f5f5f5` | Widget background |
| `widget_text_color` | color | `#222222` | Widget text |
| `widget_explanation` | textarea | *see YAML* | Intro text below title |
| `privacy_check` | checkbox | false | Show privacy consent checkbox in widget |
| `privacy_label` | text | *see YAML* | Label text next to the consent checkbox (raw HTML allowed) |
| `privacy_error` | text | *see YAML* | Error message when consent is missing |
| `max_steps` | number | 6 | Max agent loop iterations |
| `max_pages` | number | 3 | Max pages the AI may fetch |
| `extra_instructions` | textarea | *empty* | Appended to the system prompt |
| `max_questions_per_session` | number | 3 | Per-visitor daily question limit |
| `max_questions_per_day` | number | 100 | Global daily question limit |
| `max_tokens_per_day` | number | 50000 | Global daily token budget |
| `max_questions_per_minute` | number | 5 | Per-visitor burst limit |
| `max_lines_per_question` | number | 5 | Max newlines allowed in one question |
| `limit_message` | text | *see YAML* | Message shown when any limit is hit |
| `log_full_sessions` | checkbox | true | Enable detailed Markdown session logs |
| `auto_reindex` | checkbox | true | Rebuild index on publish/delete |

---

## Customisation Guide

### Change the AI behaviour

Edit the system prompt in `AskTheDocsController::agentLoop()`. Keep the **OUTPUT FORMAT** and **SECURITY AND SCOPE** blocks intact, or the AI may break the JSON contract or leak instructions.

### Add new widget settings

1. Add the default value to `settings:` in `askthedocs.yaml`
2. Add a `fields:` entry so the admin UI shows an editor
3. Read it in `askthedocs.php` via `$this->getPluginSettings()`
4. Pass it into `widget.twig`
5. Consume it in `widget.twig` or `askthedocs.css`

### Change the Markdown parser

The frontend parser lives in `js/askthedocs.js` inside `mdToHtml()`. It supports headers, lists, links, images, bold/italic, inline code, and fenced code blocks. Extend the `inlineMd()` regexes or the block parsers to add more syntax.

### Add a new admin API endpoint

1. Add a route array in `askthedocs.php::addNewRoutes()`
2. Implement the method in `AskTheDocsController`
3. Add UI in `admin.js`
4. Wire the JS call in `admin.js`

All admin routes must specify `'resource' => 'system'` and `'privilege' => 'view'` (or higher) so Laminas ACL enforces authentication.

### Replace the visitor hash logic

Edit `getVisitorHash()` in the `AskTheDocsController`. The hash is used for rate limits.

---

## Dependencies

- **Typemill core** — `Navigation`, `Content`, `Settings`, `AiAdapter`, `StorageWrapper`
- **PHP extensions** — `mbstring` (for `mb_strlen`, `mb_strtolower`, `mb_substr`), `intl` (optional, for Unicode NFKC normalization)
- **No frontend build tools** — CSS and JS are served as static files

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Missing configuration" error | AI adapter not set in system settings | Configure AI adapter + base URL + model + API key |
| Widget does not appear | Shortcode not inserted, or plugin disabled | Add `[:askthedocs:]` to a page and enable the plugin |
| "Documentation index is not available" | `summaries.json` missing | Click **Rebuild & Generate** in the admin dashboard |
| Answers are off-topic | Extra instructions too broad | Tighten `extra_instructions` or lower `max_steps` |
| Disk space growing | Full session logs enabled | Disable `log_full_sessions` or delete `log_*.md` files |
| Rate limit hit for all visitors | `max_questions_per_day` too low | Raise the global daily limit in plugin settings |
| AI cannot find a specific page | Summary is empty or vague | Edit the page summary or click **Generate AI** on that card |
