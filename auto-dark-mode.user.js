// ==UserScript==
// @name         Johnny's Auto Dark Mode
// @namespace    jsnldarkmode
// @version      1.0
// @description  Automatically invert light-themed pages when system prefers dark mode
// @author       jsnelgrove
// @match        *://*/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const LUMINANCE_THRESHOLD = 0.4;
    const RECHECK_DELAY_MS = 1500;
    const CLASS_NAME = 'jsnl-dark-mode';

    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

    function srgbToLinear(c) {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function relativeLuminance(r, g, b) {
        return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    }

    function parseRgb(color) {
        if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return null;
        const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m ? [+m[1], +m[2], +m[3]] : null;
    }

    function getPageLuminance() {
        for (const el of [document.body, document.documentElement]) {
            if (!el) continue;
            const rgb = parseRgb(window.getComputedStyle(el).backgroundColor);
            if (rgb) return relativeLuminance(...rgb);
        }
        return 1;
    }

    let styleInjected = false;

    function injectStyle() {
        if (styleInjected) return;
        styleInjected = true;
        GM_addStyle(`
            .${CLASS_NAME} {
                filter: invert(0.90) hue-rotate(180deg);
            }
            .${CLASS_NAME} img,
            .${CLASS_NAME} video,
            .${CLASS_NAME} svg image,
            .${CLASS_NAME} picture,
            .${CLASS_NAME} [style*="background-image"] {
                filter: invert(1) hue-rotate(180deg);
            }
        `);
    }

    function activate() {
        injectStyle();
        (document.documentElement ?? document.body).classList.add(CLASS_NAME);
    }

    function deactivate() {
        (document.documentElement ?? document.body).classList.remove(CLASS_NAME);
    }

    function evaluate() {
        if (!darkModeQuery.matches) {
            deactivate();
            return;
        }
        if (getPageLuminance() >= LUMINANCE_THRESHOLD) {
            activate();
        }
    }

    evaluate();
    setTimeout(evaluate, RECHECK_DELAY_MS);

    darkModeQuery.addEventListener('change', evaluate);
})();
