# Ask the Docs

Ask the Docs is a chatbot plugin for Typemill that lets your visitors ask questions about your documentation and get instant answers powered by artificial intelligence.

## What it does

Once you add the chatbot to a page, visitors can type a question like *"How do I publish a page?"* and the AI will:

1. Search through your documentation
2. Read the relevant pages
3. Give a clear answer with links to the sources

The chatbot only answers questions about your own content. It will not answer unrelated questions or follow instructions from users trying to trick it.

## How to add the chatbot to a page

1. Open any page in the visual editor
2. Click the **shortcode** button (or type it manually)
3. Choose **askthedocs** from the list
4. Save and publish the page

The chatbot will appear on that page in the frontend.

Alternatively, in the raw Markdown editor you can simply type:

```
[:askthedocs:]
```

## Admin settings

Open the plugin settings from the system menu. Here you can adjust the look and behaviour of the chatbot.

### Appearance

- **Widget Title** — the heading above the chat box (default: *Ask the Docs*)
- **Button Label** — the text on the send button (default: *Ask*)
- **Input Placeholder** — the grey hint text inside the text field
- **Widget Explanation** — a short introduction shown before the first question
- **Button Color**, **Button Text Color**, **Background Color**, **Text Color** — change the colours to match your theme

### Privacy consent

If you need visitors to agree to your privacy policy before using the chatbot:

- **Privacy Consent Checkbox** — turn this on to show a checkbox below the text input
- **Privacy Checkbox Label** — the text next to the checkbox. You can add a link to your privacy page, for example: `I agree to the <a href="/privacy">privacy policy</a>.`
- **Privacy Error Message** — the message shown when someone tries to send a question without checking the box

The visitor's choice is remembered in a cookie, so they only need to check it once per browser. They can uncheck it at any time.

### How the AI works

- **Max Agent Steps** — how many times the AI may think before it must answer (default: 6). A higher number lets the AI search deeper, but uses more resources.
- **Max Pages Fetched** — how many pages the AI may read for one question (default: 3). Usually 2–4 pages is enough.
- **Additional Agent Instructions** — extra hints you can give the AI, for example: *"Always mention the version number"* or *"Keep answers short"*. Do not try to change the answer format here.

### Limits and protection

To keep costs under control and prevent abuse, you can set several limits:

- **Max Questions per Visitor (per day)** — how many questions one person may ask per day (default: 3)
- **Max Questions per Day (global)** — total questions allowed from all visitors combined (default: 100)
- **Max Tokens per Day (global)** — rough daily budget for AI usage (default: 50 000)
- **Max Questions per Minute (per visitor)** — burst protection against rapid spam (default: 5)
- **Max Lines per Question** — rejects questions with too many line breaks, which tricks sometimes use (default: 5)
- **Limit Reached Message** — the polite message shown when a visitor hits a limit

The plugin counts visitors by their network address, so clearing cookies or using a private window does not bypass the daily limits.

### Logs

- **Log Full Sessions** — save detailed technical logs of every AI conversation for debugging (default: on). Turn this off if you want to save disk space.

### Automatic maintenance

- **Auto-reindex on content changes** — when on, the plugin rebuilds its search index every time you publish or delete a page. This makes sure the AI always works with current content.

### Public API (for other Typemill instances)

Two read-only endpoints allow remote Typemill installations to query your documentation tree and page content — useful for help systems like Kixote.

- **Enable Public Index Endpoint** — exposes `/api/v1/askthedocs/index`, which returns the full navigation tree with page summaries
- **Enable Public Page Endpoint** — exposes `/api/v1/askthedocs/page`, which returns the raw Markdown of a single page

Both endpoints are **disabled by default**. When enabled, they require a simple header authentication: the requesting client must send `X-AskTheDocs-Auth: <md5_hash_of_public_key.pem>`, where `public_key.pem` is the same file found in every Typemill `/settings` folder. This prevents casual crawlers without adding complex key management.

**Important:** The public index endpoint only serves an existing summary index. It will never generate or rebuild summaries automatically. Make sure you have built the index in the admin dashboard before enabling this feature.

## Admin dashboard

Go to **System → Ask the Docs** to open the dashboard.

### Summaries

The AI uses short summaries of each page to decide where to look for an answer. The dashboard shows all indexed pages as a card grid.

**Index status bar** (top of the Summaries tab):
- **Last built** — when the index was last updated
- **Pages indexed** — how many pages are in the index
- **Rebuild & Generate** — scans the site for new published pages, adds them to the index, and then automatically generates AI summaries for any missing entries
- **Generate All Missing** — skips the scan and only generates AI summaries for pages that currently have no summary

**Important:** The *Rebuild & Generate* and *Generate All Missing* buttons send the full page content to your AI provider for every empty summary. On a large site this can be expensive. A progress bar with a **Stop** button appears while generation is running.

**Per-page actions** (inside each card):
- **Edit a summary** — click into the text field, change the text, and press **Save**
- **Generate AI** — press this button to let the AI write a summary for this single page based on its live content

Good summaries help the chatbot find the right pages faster. New pages are added to the index with an empty summary so you can easily spot what still needs to be generated.

### Questions

This tab extracts visitor questions from the session logs and shows them in a table. Each row shows the date and the question text. Click **View log** next to a question to open the full AI conversation for that question in a modal window.

Press **Delete All Logs** to remove every session log file. This also clears the question table.

## Tips for best results

- Generate summaries for all pages before opening the chatbot to the public. Empty summaries make it harder for the AI to find relevant pages
- If an answer is wrong, open the **View log** for that question to see which pages the AI read, then improve the summary of the correct page
- Keep the **Max Agent Steps** and **Max Pages Fetched** moderate (4–8 steps, 2–4 pages). Higher values rarely improve quality but always increase cost
- If you have a large site, consider raising the daily question and token limits
- If you do not want to store any visitor data, turn off **Log Full Sessions**

## Colour and style

The widget uses simple inline styles based on your settings. If you want deeper styling, you can override the CSS classes in your theme:

- `.atd-widget` — the outer box
- `.atd-title` — the heading
- `.atd-explanation` — the intro text
- `.atd-messages` — the conversation area
- `.atd-bubble.user` — visitor messages
- `.atd-bubble.assistant` — AI answers
- `.atd-form textarea` — the input field
- `.atd-form button` — the send button

## Requirements

- A configured AI service in your Typemill system settings (OpenAI, Claude, or another compatible provider)
- Published pages in your documentation, otherwise the AI has nothing to search

## Support

If the chatbot does not appear, check that:

1. The plugin is enabled
2. The shortcode `[:askthedocs:]` is added to a published page
3. The AI service is configured in the system settings
4. The documentation index has been built at least once (visit the Ask the Docs admin page and click **Rebuild & Generate**)

If answers seem off-topic, tighten the **Additional Agent Instructions** or lower the step and page limits so the AI focuses more narrowly.

### Public API issues

- **Remote instance gets 403** — make sure the Public Index / Public Page checkbox is enabled in the plugin settings and that the remote instance sends the correct `X-AskTheDocs-Auth` header.
- **Remote instance gets 404 from `/index`** — the public endpoint only serves an existing index. Click **Rebuild & Generate** in the admin dashboard first.
