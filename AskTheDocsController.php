<?php

namespace Plugins\askthedocs;

use DI\Container;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\ResponseInterface as Response;
use Typemill\Models\Navigation;
use Typemill\Models\Content;
use Typemill\Models\Meta;
use Typemill\Models\Settings;
use Typemill\Models\ApiCalls;
use Typemill\Models\StorageWrapper;

class AskTheDocsController
{
    protected $c;
    protected $settings;

    /** Stores the raw API response body from the last callAI() call for logging. */
    private $lastRawResponse = '';

    public function __construct(Container $container)
    {
        $this->c        = $container;
        $this->settings = $container->get('settings');
    }

    // ─── Public HTTP endpoints ────────────────────────────────────────────────

    public function ask(Request $request, Response $response, $args): Response
    {
        $body = $this->parseBody($request);

        $question = trim($body['question'] ?? '');
        $history  = $body['history'] ?? [];

        if ($question === '') {
            return $this->json($response, ['error' => 'Question is required.'], 400);
        }
        if (mb_strlen($question) > 500) {
            return $this->json($response, ['error' => 'Question too long (max 500 characters).'], 400);
        }
        if (!is_array($history)) {
            $history = [];
        }
        $history = array_slice($history, -10);

        $aiservice = $this->settings['aiservice'] ?? 'none';
        if (!$aiservice || $aiservice === 'none') {
            return $this->json($response, ['error' => 'AI service not configured. Please go to Settings → AI and configure it.'], 400);
        }

        $urlinfo  = $this->c->get('urlinfo');
        $langattr = $this->settings['langattr'] ?? false;

        $navigation = new Navigation();
        $nav        = $navigation->getFullDraftNavigation($urlinfo, $langattr);

        if (!$nav) {
            return $this->json($response, ['error' => 'Documentation index is not available.'], 500);
        }

        $summaries = $this->loadSummaries();
        $rootIndex = [];

        // Build a two-level index so the AI can see folders AND their children
        // immediately, without needing a separate open_folder step for the top level.
        foreach ($nav as $item) {
            $path = $item->urlRelWoF ?? '';
            $node = [
                'type'    => $item->elementType ?? 'file',
                'title'   => $item->name ?? '',
                'summary' => $summaries[$path]['summary'] ?? '',
                'path'    => $path,
            ];
            if ($node['type'] === 'folder') {
                $children = $this->getFolder($path, $summaries);
                if (!empty($children)) {
                    $node['children'] = $children;
                }
            }
            $rootIndex[] = $node;
        }

        $result = $this->agentLoop($question, $rootIndex, $history, $summaries);

        return $this->json($response, $result);
    }

    public function reindex(Request $request, Response $response, $args): Response
    {
        $count = $this->buildSummaryIndex();

        return $this->json($response, [
            'pages'   => $count,
            'message' => 'Index rebuilt successfully.',
        ]);
    }

    public function status(Request $request, Response $response, $args): Response
    {
        $summaries = $this->loadSummaries();
        $built     = $summaries['built'] ?? null;
        unset($summaries['built']);

        $list = [];
        foreach ($summaries as $url => $data) {
            $list[] = [
                'url'     => $url,
                'title'   => $data['title'] ?? '',
                'summary' => $data['summary'] ?? '',
            ];
        }

        return $this->json($response, [
            'built'     => $built,
            'pagecount' => count($list),
            'summaries' => $list,
        ]);
    }

    public function updateSummary(Request $request, Response $response, $args): Response
    {
        $body    = $this->parseBody($request);
        $path    = trim($body['path'] ?? '');
        $summary = trim($body['summary'] ?? '');

        if ($path === '') {
            return $this->json($response, ['error' => 'Path is required.'], 400);
        }

        $summaries = $this->loadSummaries();

        if (!isset($summaries[$path])) {
            $summaries[$path] = ['title' => '', 'summary' => ''];
        }
        $summaries[$path]['summary'] = $summary;

        $this->storeSummaries($summaries);

        return $this->json($response, ['message' => 'Saved.']);
    }

    public function generateSummary(Request $request, Response $response, $args): Response
    {
        $body = $this->parseBody($request);
        $path = trim($body['path'] ?? '');

        if ($path === '') {
            return $this->json($response, ['error' => 'Path is required.'], 400);
        }

        $aiservice = $this->settings['aiservice'] ?? 'none';
        if (!$aiservice || $aiservice === 'none') {
            return $this->json($response, ['error' => 'AI service not configured.'], 400);
        }

        $markdown = $this->getPage($path);
        if ($markdown === '') {
            return $this->json($response, ['error' => 'Page not found or empty.'], 404);
        }

        $truncated    = mb_substr($markdown, 0, 2000);
        $systemPrompt = 'You are a documentation summarizer. Return only valid JSON with a single "summary" key containing 1-2 sentences. Example: {"summary": "Describes how to configure authentication."}';
        $messages     = [
            ['role' => 'user', 'content' => "Summarize this documentation page in 1-2 sentences for a navigation index:\n\n" . $truncated],
        ];

        $raw  = $this->callAI($messages, $systemPrompt);
        $data = json_decode($raw, true);

        $summary = is_array($data) ? ($data['summary'] ?? '') : '';
        if ($summary === '') {
            return $this->json($response, ['error' => 'AI did not return a valid summary.'], 500);
        }

        $summaries = $this->loadSummaries();
        if (!isset($summaries[$path])) {
            $summaries[$path] = ['title' => '', 'summary' => ''];
        }
        $summaries[$path]['summary'] = $summary;
        $this->storeSummaries($summaries);

        return $this->json($response, ['summary' => $summary]);
    }

    // ─── Public: called from plugin event handler ─────────────────────────────

    public function buildSummaryIndex(): int
    {
        $urlinfo  = $this->c->get('urlinfo');
        $langattr = $this->settings['langattr'] ?? false;

        $navigation = new Navigation();
        $nav        = $navigation->getFullDraftNavigation($urlinfo, $langattr);

        if (!$nav) {
            return 0;
        }

        $flat      = $navigation->flatten($nav, '', []);
        $summaries = $this->loadSummaries();

        // Preserve the built timestamp while we iterate
        $built = $summaries['built'] ?? null;
        unset($summaries['built']);

        foreach ($flat as $item) {
            if (($item->elementType ?? '') !== 'file') {
                continue;
            }
            if (($item->status ?? '') !== 'published') {
                continue;
            }

            $url = $item->urlRelWoF ?? '';
            if ($url === '' || isset($summaries[$url])) {
                continue;
            }

            // Use the meta description as the default summary
            $meta     = new Meta();
            $metaData = $meta->getMetaData($item);
            $summary  = $metaData['meta']['description'] ?? '';

            $summaries[$url] = [
                'title'   => $item->name ?? '',
                'summary' => $summary,
            ];
        }

        $summaries['built'] = date('c');
        $this->storeSummaries($summaries);

        return count($summaries) - 1; // subtract the 'built' key
    }

    // ─── Private: agent loop ──────────────────────────────────────────────────

    private function agentLoop(string $question, array $rootIndex, array $history, array $summaries): array
    {
        $pluginSettings = $this->settings['plugins']['askthedocs'] ?? [];
        $maxSteps       = max(1, (int)($pluginSettings['max_steps'] ?? 6));
        $maxPages       = max(1, (int)($pluginSettings['max_pages'] ?? 3));

        $systemPrompt = "You are a documentation navigation assistant. Find and read the right pages to answer the user's question.\n\n"
            . "OUTPUT FORMAT — critical:\n"
            . "- Your ENTIRE response must be one raw JSON object.\n"
            . "- Start with { and end with }.\n"
            . "- No text before or after the JSON.\n"
            . "- No markdown code fences (no backticks).\n"
            . "- No XML tags, no <function_calls>, no tool use.\n"
            . "- One action per response only.\n\n"
            . "Actions:\n"
            . "{\"action\":\"open_folder\",\"path\":\"/exact-path-from-index\"}\n"
            . "{\"action\":\"open_page\",\"path\":\"/exact-path-from-index\"}\n"
            . "{\"action\":\"answer\",\"answer\":\"your full answer here\"}\n\n"
            . "Rules:\n"
            . "1. Only use path values from the index you received — never invent paths.\n"
            . "2. You MUST open and read at least one page before answering.\n"
            . "3. Prefer open_page when a title/summary clearly matches the question.\n"
            . "4. Write the answer in the same language as the question.\n"
            . "5. If no relevant page exists, say so in the answer field.";

        $extraInstructions = trim($pluginSettings['extra_instructions'] ?? '');
        if ($extraInstructions !== '') {
            $systemPrompt .= "\n\nAdditional instructions:\n" . $extraInstructions;
        }

        $aiservice = $this->settings['aiservice'] ?? 'none';
        $model     = ($aiservice === 'claude')
            ? ($this->settings['claudeModel'] ?? 'claude-3-5-haiku-20241022')
            : ($this->settings['chatgptModel'] ?? 'gpt-4o-mini');

        // ── Start session log ────────────────────────────────────────────────
        $log   = [];
        $log[] = '# Ask the Docs — Session Log';
        $log[] = '';
        $log[] = '**Date:** ' . date('Y-m-d H:i:s');
        $log[] = '**AI service:** ' . $aiservice . ' / ' . $model;
        $log[] = '**Max steps:** ' . $maxSteps . ' | **Max pages:** ' . $maxPages;
        $log[] = '';
        $log[] = '**Question:** ' . $question;
        $log[] = '';
        $log[] = '**System prompt:**';
        $log[] = '```';
        $log[] = $systemPrompt;
        $log[] = '```';
        $log[] = '';
        $log[] = '**Root index sent:**';
        $log[] = '```json';
        $log[] = json_encode($rootIndex, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $log[] = '```';
        $log[] = '';
        $log[] = '**History turns seeded:** ' . count($history);
        $log[] = '';
        $log[] = '---';
        $log[] = '';

        // Seed messages with the last 6 turns of chat history
        $messages     = array_slice($history, -6);
        $sources      = [];
        $pagesRead    = 0;
        $lastStepData = null;

        for ($step = 1; $step <= $maxSteps; $step++) {

            $log[] = '## Step ' . $step;
            $log[] = '';

            // Build the user message for this step
            if ($step === 1) {
                $userContent = $question . "\n\nDocumentation index:\n" . json_encode($rootIndex);
            } else {
                $userContent = json_encode($lastStepData);
            }

            $forced = false;
            // If we've hit the limit, append a force-answer instruction
            if ($step >= $maxSteps || $pagesRead >= $maxPages) {
                $userContent .= "\n\nYou must answer now. Return: {\"action\":\"answer\",\"answer\":\"your answer here\"}";
                $forced = true;
            }

            $log[] = '**Force-answer injected:** ' . ($forced ? 'yes' : 'no');
            $log[] = '';
            $log[] = '**User message sent:**';
            $log[] = '```';
            $log[] = $userContent;
            $log[] = '```';
            $log[] = '';

            $messages[] = ['role' => 'user', 'content' => $userContent];

            // Call AI
            $raw = $this->callAI($messages, $systemPrompt);

            $log[] = '**Raw API response body:**';
            $log[] = '```';
            $log[] = $this->lastRawResponse;
            $log[] = '```';
            $log[] = '';
            $log[] = '**Extracted text from AI:**';
            $log[] = '```';
            $log[] = $raw;
            $log[] = '```';
            $log[] = '';

            // Parse JSON — strips markdown fences and extracts first {…} block
            $agentResponse = $this->extractJson($raw);
            if (!is_array($agentResponse)) {
                $log[] = '**JSON extraction failed on first attempt (raw text above). Retrying…**';
                $log[] = '';
                $messages[] = ['role' => 'user', 'content' => 'Your last response was not valid JSON. Reply with ONLY a raw JSON object starting with { and ending with }. No markdown fences, no prose.'];
                $raw           = $this->callAI($messages, $systemPrompt);
                $agentResponse = $this->extractJson($raw);

                $log[] = '**Retry raw API response:**';
                $log[] = '```';
                $log[] = $this->lastRawResponse;
                $log[] = '```';
                $log[] = '';
                $log[] = '**Retry extracted text:**';
                $log[] = '```';
                $log[] = $raw;
                $log[] = '```';
                $log[] = '';

                if (!is_array($agentResponse)) {
                    $log[] = '**JSON extraction failed on retry. Breaking loop.**';
                    $log[] = '';
                    break;
                }
            }

            $messages[] = ['role' => 'assistant', 'content' => $raw];

            $action = $agentResponse['action'] ?? '';
            $log[]  = '**Action returned:** `' . $action . '`';
            $log[]  = '';

            if ($action === 'open_folder') {
                $path = $agentResponse['path'] ?? '';
                if ($path === '') {
                    $log[]        = '**Error:** missing path for open_folder.';
                    $log[]        = '';
                    $lastStepData = ['error' => 'Missing path for open_folder.'];
                    continue;
                }
                $children = $this->getFolder($path, $summaries);
                $log[]    = '**Folder path:** `' . $path . '` — children found: ' . count($children);
                $log[]    = '';
                if (empty($children)) {
                    $lastStepData = ['path' => $path, 'error' => 'Folder not found or has no children.'];
                } else {
                    $lastStepData = ['path' => $path, 'children' => $children];
                }

            } elseif ($action === 'open_page') {
                $path = $agentResponse['path'] ?? '';
                if ($path === '') {
                    $log[]        = '**Error:** missing path for open_page.';
                    $log[]        = '';
                    $lastStepData = ['error' => 'Missing path for open_page.'];
                    continue;
                }
                $pagesRead++;
                $content      = $this->getPage($path);
                $lastStepData = ['path' => $path, 'content' => $content];
                $sources[]    = [
                    'url'   => $path,
                    'title' => $summaries[$path]['title'] ?? ltrim($path, '/'),
                ];
                $log[] = '**Page path:** `' . $path . '` — content length: ' . mb_strlen($content) . ' chars';
                $log[] = '';

            } elseif ($action === 'answer') {
                $answer = $agentResponse['answer'] ?? '';
                $log[]  = '**Answer returned:**';
                $log[]  = '```';
                $log[]  = $answer;
                $log[]  = '```';
                $log[]  = '';
                $log[]  = '---';
                $log[]  = '';
                $log[]  = '## Result: answer';
                $log[]  = '';
                $log[]  = '**Sources:** ' . count($sources);

                $this->writeLog($log);

                return [
                    'answer'  => $answer,
                    'sources' => $sources,
                ];

            } else {
                // Unknown action — treat as no-op
                $log[]        = '**Unknown action — treated as no-op.**';
                $log[]        = '';
                $lastStepData = ['error' => 'Unknown action received: ' . $action];
            }

            $log[] = '---';
            $log[] = '';
        }

        $log[] = '## Result: fallback (loop exhausted or JSON parse failed)';
        $log[] = '';
        $log[] = '**Sources collected:** ' . count($sources);

        $this->writeLog($log);

        return [
            'answer'  => 'I could not find a specific answer in the documentation. Please try rephrasing your question or browse the docs directly.',
            'sources' => $sources,
        ];
    }

    private function writeLog(array $lines): void
    {
        $filename = 'log_' . date('Ymd_His') . '.md';
        $content  = implode("\n", $lines) . "\n";

        $storage = new StorageWrapper($this->settings['storage']);
        $storage->writeFile('dataFolder', 'askthedocs', $filename, $content);
    }

    // ─── Private: AI call ─────────────────────────────────────────────────────

    private function callAI(array $messages, string $systemPrompt): string
    {
        $aiservice     = $this->settings['aiservice'] ?? false;
        $settingsModel = new Settings();
        $apiCalls      = new ApiCalls();
        $apiCalls->setTimeout(60);

        if ($aiservice === 'claude') {
            $apikey  = $settingsModel->getSecret('claudeKey');
            $model   = $this->settings['claudeModel'] ?? 'claude-3-5-haiku-20241022';
            $url     = 'https://api.anthropic.com/v1/messages';
            $headers = [
                'x-api-key: ' . $apikey,
                'anthropic-version: 2023-06-01',
            ];
            $payload = [
                'model'      => $model,
                'system'     => $systemPrompt,
                'messages'   => $messages,
                'max_tokens' => 1024,
            ];
            $raw                    = $apiCalls->makePostCall($url, $payload, $headers);
            $this->lastRawResponse  = $raw ?: ('curl/http error: ' . $apiCalls->getError());
            $data                   = json_decode($raw, true);
            return $data['content'][0]['text'] ?? '';
        }

        if ($aiservice === 'chatgpt') {
            $apikey       = $settingsModel->getSecret('chatgptKey');
            $model        = $this->settings['chatgptModel'] ?? 'gpt-4o-mini';
            $url          = 'https://api.openai.com/v1/chat/completions';
            $chatMessages = array_merge(
                [['role' => 'system', 'content' => $systemPrompt]],
                $messages
            );
            $payload = [
                'model'      => $model,
                'messages'   => $chatMessages,
                'max_tokens' => 1024,
            ];
            $raw                   = $apiCalls->makePostCall($url, $payload, 'Authorization: Bearer ' . $apikey);
            $this->lastRawResponse = $raw ?: ('curl/http error: ' . $apiCalls->getError());
            $data                  = json_decode($raw, true);
            return $data['choices'][0]['message']['content'] ?? '';
        }

        $this->lastRawResponse = 'No AI service matched (aiservice=' . $aiservice . ')';
        return '';
    }

    // ─── Private: navigation helpers ─────────────────────────────────────────

    private function getFolder(string $path, array $summaries): array
    {
        $urlinfo  = $this->c->get('urlinfo');
        $langattr = $this->settings['langattr'] ?? false;

        $navigation = new Navigation();
        $item       = $navigation->getItemForUrl($path, $urlinfo, $langattr);

        if (!$item) {
            return [];
        }

        $children = $item->folderContent ?? [];
        $result   = [];

        foreach ($children as $child) {
            $childPath = $child->urlRelWoF ?? '';
            $result[]  = [
                'type'    => $child->elementType ?? 'file',
                'title'   => $child->name ?? '',
                'summary' => $summaries[$childPath]['summary'] ?? '',
                'path'    => $childPath,
            ];
        }

        return $result;
    }

    private function getPage(string $path): string
    {
        $urlinfo  = $this->c->get('urlinfo');
        $langattr = $this->settings['langattr'] ?? false;

        $navigation = new Navigation();
        $item       = $navigation->getItemForUrl($path, $urlinfo, $langattr);

        if (!$item) {
            return '';
        }

        $content = new Content($urlinfo['baseurl'], $this->settings, $this->c->get('dispatcher'));
        return $content->getLiveMarkdown($item) ?? '';
    }

    // ─── Private: storage helpers ─────────────────────────────────────────────

    private function loadSummaries(): array
    {
        $storage = new StorageWrapper($this->settings['storage']);
        $data    = $storage->getFile('dataFolder', 'askthedocs', 'summaries.json');

        if ($data && is_string($data)) {
            $decoded = json_decode($data, true);
            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }

    private function storeSummaries(array $summaries): void
    {
        $storage = new StorageWrapper($this->settings['storage']);
        $storage->writeFile(
            'dataFolder',
            'askthedocs',
            'summaries.json',
            json_encode($summaries, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
        );
    }

    // ─── Private: response helpers ────────────────────────────────────────────

    private function json(Response $response, array $data, int $status = 200): Response
    {
        $response->getBody()->write(json_encode($data));
        return $response->withHeader('Content-Type', 'application/json')->withStatus($status);
    }

    private function parseBody(Request $request): array
    {
        $body = $request->getParsedBody();
        if (!is_array($body)) {
            $body = json_decode((string)$request->getBody(), true) ?? [];
        }
        return $body;
    }

    /**
     * Robustly extract a JSON object from an AI response that may contain:
     * - Prose before/after the JSON
     * - Markdown code fences (```json ... ```)
     * - <function_calls> XML wrappers
     *
     * Strategy:
     * 1. Direct json_decode (clean response — fastest path)
     * 2. Strip markdown fences and retry
     * 3. Find the first balanced { … } block in the raw text
     */
    private function extractJson(string $text): ?array
    {
        $text = trim($text);

        // 1. Direct parse — best case
        $decoded = json_decode($text, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        // 2. Strip markdown code fences: ```json...``` or ```...```
        $stripped = preg_replace('/^```(?:json)?\s*/m', '', $text);
        $stripped = preg_replace('/^```\s*$/m', '', $stripped);
        $stripped = trim($stripped);

        $decoded = json_decode($stripped, true);
        if (is_array($decoded)) {
            return $decoded;
        }

        // 3. Walk the string to find the first complete balanced { … } block,
        //    correctly handling strings and escape sequences.
        $len   = strlen($text);
        $start = null;
        $depth = 0;
        $inStr = false;
        $esc   = false;

        for ($i = 0; $i < $len; $i++) {
            $ch = $text[$i];

            if ($esc) {
                $esc = false;
                continue;
            }
            if ($ch === '\\' && $inStr) {
                $esc = true;
                continue;
            }
            if ($ch === '"') {
                $inStr = !$inStr;
                continue;
            }
            if ($inStr) {
                continue;
            }

            if ($ch === '{') {
                if ($depth === 0) {
                    $start = $i;
                }
                $depth++;
            } elseif ($ch === '}') {
                $depth--;
                if ($depth === 0 && $start !== null) {
                    $candidate = substr($text, $start, $i - $start + 1);
                    $decoded   = json_decode($candidate, true);
                    if (is_array($decoded)) {
                        return $decoded;
                    }
                    // Not valid JSON — keep scanning for the next block
                    $start = null;
                }
            }
        }

        return null;
    }
}
