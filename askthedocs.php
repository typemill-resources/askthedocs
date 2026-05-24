<?php

namespace Plugins\askthedocs;

use Typemill\Plugin;
use Plugins\askthedocs\AskTheDocsController;

class askthedocs extends Plugin
{
    public static function getSubscribedEvents()
    {
        return [
            'onShortcodeFound'   => ['onShortcodeFound', 0],
            'onTwigLoaded'       => ['onTwigLoaded', 0],
            'onSystemnaviLoaded' => ['onSystemnaviLoaded', 0],
            'onPageReady'        => ['onPageReady', 0],
            'onPagePublished'    => ['onContentChanged', 0],
            'onPageDeleted'      => ['onContentChanged', 0],
            'onCacheUpdated'     => ['onContentChanged', 0],
        ];
    }

    public static function addNewRoutes()
    {
        return [
            // Public — answer a question (no auth required)
            [
                'httpMethod' => 'post',
                'route'      => '/api/v1/askthedocs/ask',
                'name'       => 'askthedocs.ask',
                'class'      => 'Plugins\askthedocs\AskTheDocsController:ask',
            ],

            // Admin — rebuild summary index
            [
                'httpMethod' => 'post',
                'route'      => '/api/v1/askthedocs/reindex',
                'name'       => 'askthedocs.reindex',
                'class'      => 'Plugins\askthedocs\AskTheDocsController:reindex',
                'resource'   => 'system',
                'privilege'  => 'view',
            ],

            // Admin — update a single page summary
            [
                'httpMethod' => 'post',
                'route'      => '/api/v1/askthedocs/summary',
                'name'       => 'askthedocs.summary',
                'class'      => 'Plugins\askthedocs\AskTheDocsController:updateSummary',
                'resource'   => 'system',
                'privilege'  => 'view',
            ],

            // Admin — get index status + summary list
            [
                'httpMethod' => 'get',
                'route'      => '/api/v1/askthedocs/status',
                'name'       => 'askthedocs.status',
                'class'      => 'Plugins\askthedocs\AskTheDocsController:status',
                'resource'   => 'system',
                'privilege'  => 'view',
            ],

            // Admin — generate AI summary for one page
            [
                'httpMethod' => 'post',
                'route'      => '/api/v1/askthedocs/generate-summary',
                'name'       => 'askthedocs.generate-summary',
                'class'      => 'Plugins\askthedocs\AskTheDocsController:generateSummary',
                'resource'   => 'system',
                'privilege'  => 'view',
            ],

            // Admin page (system UI shell)
            [
                'httpMethod' => 'get',
                'route'      => '/tm/askthedocs',
                'name'       => 'askthedocs.admin',
                'class'      => 'Typemill\Controllers\ControllerWebSystem:blankSystemPage',
                'resource'   => 'system',
                'privilege'  => 'view',
            ],
        ];
    }

    public function onShortcodeFound($shortcode)
    {
        $shortcodeArray = $shortcode->getData();

        // Register this shortcode so it appears in the editor shortcode list
        if (is_array($shortcodeArray) && $shortcodeArray['name'] === 'registershortcode') {
            $shortcodeArray['data']['askthedocs'] = [];
            $shortcode->setData($shortcodeArray);
            return;
        }

        // Render the [askthedocs] widget
        if (is_array($shortcodeArray) && $shortcodeArray['name'] === 'askthedocs') {
            $shortcode->stopPropagation();

            $settings = $this->getPluginSettings();
            $twig     = $this->getTwig();
            $loader   = $twig->getLoader();
            $loader->addPath(__DIR__ . '/templates');

            $html = $twig->fetch('/widget.twig', [
                'widget_title' => $settings['widget_title'] ?? 'Ask the Docs',
            ]);

            $shortcode->setData($html);
        }
    }

    public function onTwigLoaded()
    {
        if (!$this->adminroute) {
            $this->addCSS('/askthedocs/css/askthedocs.css');
            $this->addJS('/askthedocs/js/askthedocs.js');
        }
    }

    public function onSystemnaviLoaded($navidata)
    {
        $this->addSvgSymbol(
            '<symbol id="icon-askthedocs" viewBox="0 0 24 24">' .
            '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>' .
            '<path fill="rgba(255,255,255,.8)" d="M7 9h10v2H7zm0 3h7v2H7z"/>' .
            '</symbol>'
        );

        $navi = $navidata->getData();

        $navi['AskTheDocs'] = [
            'title'        => 'Ask the Docs',
            'routename'    => 'askthedocs.admin',
            'icon'         => 'icon-askthedocs',
            'aclresource'  => 'system',
            'aclprivilege' => 'view',
        ];

        if (trim($this->route, '/') === 'tm/askthedocs') {
            $navi['AskTheDocs']['active'] = true;
            $this->addJS('/askthedocs/js/admin.js');
        }

        $navidata->setData($navi);
    }

    public function onPageReady($data)
    {
        if ($this->adminroute && trim($this->route, '/') === 'tm/askthedocs') {
            $twig   = $this->getTwig();
            $loader = $twig->getLoader();
            $loader->addPath(__DIR__ . '/templates');

            $content  = $twig->fetch('/admin.twig', []);
            $pagedata = $data->getData();
            $pagedata['content'] = $content;
            $data->setData($pagedata);
        }
    }

    public function onContentChanged($event)
    {
        $settings = $this->getPluginSettings();
        if ($settings && !empty($settings['auto_reindex'])) {
            $controller = new AskTheDocsController($this->container);
            $controller->buildSummaryIndex();
        }
    }
}
