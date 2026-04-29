// ==UserScript==
// @name         Page Reader
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Read any page aloud via OpenRouter TTS — collapsible edge panel with full playback control
// @author       You
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      openrouter.ai
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* ------------------------------------------------------------------
       CONFIG
       ------------------------------------------------------------------ */
    const STORAGE_KEY       = 'openrouter-api-key';
    const VOICE_PREF_KEY    = 'tts-voice-pref';
    const CUSTOM_VOICE_KEY  = 'tts-custom-voice';
    const ENDPOINT          = 'https://openrouter.ai/api/v1/audio/speech';
    const MODEL             = 'hexgrad/kokoro-82m';
    const VOICES            = { female: 'af_heart', male: 'am_puck' };
    const FORMAT            = 'mp3';
    const MAX_CHUNK         = 3000;

    function getVoice() {
        const pref = GM_getValue(VOICE_PREF_KEY, 'female');
        if (pref === 'custom') return GM_getValue(CUSTOM_VOICE_KEY, '') || VOICES.female;
        return VOICES[pref] || VOICES.female;
    }

    /* ------------------------------------------------------------------
       API Key  (prompt + Tampermonkey menu)
       ------------------------------------------------------------------ */
    function getApiKey() {
        return GM_getValue(STORAGE_KEY, '');
    }
    function setApiKey(key) {
        GM_setValue(STORAGE_KEY, key);
    }

    GM_registerMenuCommand('🔑 Set OpenRouter API Key', () => {
        const key = prompt('Enter your OpenRouter API Key:', getApiKey());
        if (key !== null) setApiKey(key.trim());
    });

    /* ------------------------------------------------------------------
       TEXT EXTRACTION
       ------------------------------------------------------------------ */
    function getPageText() {
        const root =
            document.querySelector('article') ||
            document.querySelector('main') ||
            document.querySelector('[role="main"]') ||
            document.body;

        const clone = root.cloneNode(true);

        const junk = `
            script, style, noscript, iframe,
            nav, footer, header, aside,
            [aria-hidden="true"],
            .advertisement, .ad, #comments,
            svg, canvas, pre, code,
            .nav, .menu, .sidebar, .cookie-banner
        `;
        clone.querySelectorAll(junk).forEach(el => el.remove());

        return clone.innerText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }

    /* ------------------------------------------------------------------
       CHUNKING
       ------------------------------------------------------------------ */
    function splitIntoChunks(text, maxLen) {
        if (text.length <= maxLen) return [text];

        const chunks = [];
        const paragraphs = text.split(/\n{2,}/);
        let cur = '';

        for (const p of paragraphs) {
            if ((cur + '\n\n' + p).length > maxLen && cur) {
                chunks.push(cur.trim());
                cur = p;
            } else {
                cur = cur ? cur + '\n\n' + p : p;
            }
        }
        if (cur.trim()) chunks.push(cur.trim());

        const finalChunks = [];
        for (const chunk of chunks) {
            if (chunk.length <= maxLen) {
                finalChunks.push(chunk);
                continue;
            }
            const sentences = chunk.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [chunk];
            let sCur = '';
            for (const s of sentences) {
                if ((sCur + s).length > maxLen && sCur) {
                    finalChunks.push(sCur.trim());
                    sCur = s;
                } else {
                    sCur += s;
                }
            }
            if (sCur.trim()) finalChunks.push(sCur.trim());
        }
        return finalChunks;
    }

    /* ------------------------------------------------------------------
       TTS FETCH
       ------------------------------------------------------------------ */
    function fetchAudio(text, apiKey, voice) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: ENDPOINT,
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': location.href,
                    'X-Title': 'Page Reader Userscript'
                },
                data: JSON.stringify({
                    model: MODEL,
                    input: text,
                    voice: voice,
                    response_format: FORMAT
                }),
                responseType: 'arraybuffer',
                onload(resp) {
                    if (resp.status >= 200 && resp.status < 300) {
                        resolve(resp.response);
                    } else {
                        let detail = `TTS API ${resp.status}`;
                        try {
                            const t = resp.responseText || new TextDecoder().decode(resp.response);
                            detail = t.slice(0, 200);
                        } catch {}
                        if (resp.status === 401) setApiKey('');
                        reject(new Error(detail));
                    }
                },
                onerror() {
                    reject(new Error('Network error contacting OpenRouter'));
                }
            });
        });
    }

    /* ------------------------------------------------------------------
       UI — Collapsible Edge Tab + Panel
       ------------------------------------------------------------------ */
    let panelExpanded = false;
    let currentObjectUrl = null;

    // Minimal silent WAV so the audio player's play button stays active
    const silentWav = new Uint8Array([
        0x52,0x49,0x46,0x46, 0x26,0x00,0x00,0x00, 0x57,0x41,0x56,0x45,
        0x66,0x6D,0x74,0x20, 0x10,0x00,0x00,0x00, 0x01,0x00, 0x01,0x00,
        0x44,0xAC,0x00,0x00, 0x88,0x58,0x01,0x00, 0x02,0x00, 0x10,0x00,
        0x64,0x61,0x74,0x61, 0x02,0x00,0x00,0x00, 0x00,0x00
    ]);
    const silentBlobUrl = URL.createObjectURL(new Blob([silentWav], { type: 'audio/wav' }));

    const FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

    const THEME = {
        light: {
            panelBg: '#fff',
            panelText: '#1f2937',
            panelShadow: '-4px 0 24px rgba(0,0,0,0.15)',
            tabBg: 'rgba(55, 65, 81, 0.85)',
            tabBgHover: 'rgba(55, 65, 81, 1)',
            muted: '#6b7280',
            btnBg: '#f9fafb',
            btnText: '#374151',
            border: '#d1d5db',
            inputBg: '#fff',
            textareaBg: '#fff',
        },
        dark: {
            panelBg: '#1f2937',
            panelText: '#e5e7eb',
            panelShadow: '-4px 0 24px rgba(0,0,0,0.4)',
            tabBg: 'rgba(31, 41, 55, 0.9)',
            tabBgHover: 'rgba(31, 41, 55, 1)',
            muted: '#9ca3af',
            btnBg: '#374151',
            btnText: '#e5e7eb',
            border: '#4b5563',
            inputBg: '#111827',
            textareaBg: '#111827',
        }
    };
    const ACCENT = '#4f46e5';
    const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
    function t() { return THEME[darkMq.matches ? 'dark' : 'light']; }

    // Tab (right-edge toggle)
    const tab = document.createElement('div');
    Object.assign(tab.style, {
        position: 'fixed',
        top: '25vh',
        right: '0',
        width: '36px',
        height: '48px',
        background: t().tabBg,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '8px 0 0 8px',
        cursor: 'pointer',
        zIndex: '999999',
        fontSize: '18px',
        boxShadow: '-2px 0 8px rgba(0,0,0,0.15)',
        transition: 'background 0.15s, right 0.2s',
        userSelect: 'none',
        fontFamily: FONT
    });
    tab.textContent = '🔊';
    tab.title = 'TTS Reader';
    tab.addEventListener('mouseenter', () => { tab.style.background = t().tabBgHover; });
    tab.addEventListener('mouseleave', () => { tab.style.background = t().tabBg; });

    // Panel
    const panel = document.createElement('div');
    Object.assign(panel.style, {
        position: 'fixed',
        top: '25vh',
        right: '0',
        width: '280px',
        background: t().panelBg,
        borderRadius: '12px 0 0 12px',
        boxShadow: t().panelShadow,
        padding: '16px',
        zIndex: '999998',
        fontFamily: FONT,
        fontSize: '14px',
        color: t().panelText,
        display: 'none',
        flexDirection: 'column',
        gap: '12px',
        boxSizing: 'border-box'
    });

    // Voice selector
    const voiceRow = document.createElement('div');
    Object.assign(voiceRow.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap'
    });

    const voiceLabel = document.createElement('span');
    voiceLabel.textContent = 'Voice:';
    Object.assign(voiceLabel.style, { fontSize: '12px', color: t().muted });
    voiceRow.appendChild(voiceLabel);

    const savedPref = GM_getValue(VOICE_PREF_KEY, 'female');

    const customVoiceInput = document.createElement('input');
    customVoiceInput.type = 'text';
    customVoiceInput.placeholder = 'e.g. af_bella';
    customVoiceInput.value = GM_getValue(CUSTOM_VOICE_KEY, '');
    Object.assign(customVoiceInput.style, {
        display: 'none',
        width: '100%',
        padding: '4px 8px',
        fontSize: '12px',
        fontFamily: FONT,
        border: `1px solid ${t().border}`,
        borderRadius: '4px',
        boxSizing: 'border-box',
        color: t().panelText,
        background: t().inputBg,
        outline: 'none'
    });
    customVoiceInput.addEventListener('focus', () => { customVoiceInput.style.borderColor = ACCENT; });
    customVoiceInput.addEventListener('blur', () => { customVoiceInput.style.borderColor = t().border; });
    customVoiceInput.addEventListener('input', () => {
        GM_setValue(CUSTOM_VOICE_KEY, customVoiceInput.value.trim());
        resetPlayer();
    });

    const voiceOptions = ['female', 'male', 'custom'];
    const voiceBtns = voiceOptions.map((opt) => {
        const b = document.createElement('button');
        b.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
        b.dataset.voice = opt;
        const active = opt === savedPref;
        Object.assign(b.style, {
            padding: '2px 8px',
            fontSize: '12px',
            border: `1px solid ${t().border}`,
            borderRadius: '4px',
            cursor: 'pointer',
            background: active ? ACCENT : t().btnBg,
            color: active ? '#fff' : t().btnText,
            fontFamily: FONT,
            transition: 'all 0.1s'
        });
        if (active && opt === 'custom') customVoiceInput.style.display = 'block';
        b.addEventListener('click', () => {
            GM_setValue(VOICE_PREF_KEY, opt);
            customVoiceInput.style.display = opt === 'custom' ? 'block' : 'none';
            voiceBtns.forEach((sb) => {
                const isActive = sb.dataset.voice === opt;
                sb.style.background = isActive ? ACCENT : t().btnBg;
                sb.style.color = isActive ? '#fff' : t().btnText;
            });
            resetPlayer();
        });
        voiceRow.appendChild(b);
        return b;
    });

    // Custom text drawer
    let drawerOpen = false;

    const drawerToggle = document.createElement('div');
    Object.assign(drawerToggle.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        cursor: 'pointer',
        fontSize: '12px',
        color: t().muted,
        userSelect: 'none'
    });
    const chevron = document.createElement('span');
    chevron.textContent = '▸';
    Object.assign(chevron.style, {
        transition: 'transform 0.15s',
        display: 'inline-block',
        fontSize: '10px'
    });
    const drawerLabel = document.createElement('span');
    drawerLabel.textContent = 'Custom text';
    drawerToggle.appendChild(chevron);
    drawerToggle.appendChild(drawerLabel);

    const drawerBody = document.createElement('div');
    Object.assign(drawerBody.style, {
        display: 'none',
        flexDirection: 'column',
        gap: '6px'
    });

    const textArea = document.createElement('textarea');
    textArea.placeholder = 'Paste text here to read instead of the page…';
    Object.assign(textArea.style, {
        width: '100%',
        height: '100px',
        padding: '8px',
        fontSize: '13px',
        fontFamily: FONT,
        border: `1px solid ${t().border}`,
        borderRadius: '6px',
        resize: 'vertical',
        boxSizing: 'border-box',
        color: t().panelText,
        background: t().textareaBg,
        outline: 'none'
    });
    textArea.addEventListener('focus', () => { textArea.style.borderColor = ACCENT; });
    textArea.addEventListener('blur', () => { textArea.style.borderColor = t().border; });

    const clearLink = document.createElement('span');
    clearLink.textContent = 'Clear';
    Object.assign(clearLink.style, {
        fontSize: '11px',
        color: t().muted,
        cursor: 'pointer',
        alignSelf: 'flex-end',
        display: 'none'
    });
    clearLink.addEventListener('click', () => {
        textArea.value = '';
        clearLink.style.display = 'none';
        resetPlayer();
    });

    textArea.addEventListener('input', () => {
        clearLink.style.display = textArea.value.trim() ? 'inline' : 'none';
        resetPlayer();
    });

    drawerBody.appendChild(textArea);
    drawerBody.appendChild(clearLink);

    drawerToggle.addEventListener('click', () => {
        drawerOpen = !drawerOpen;
        drawerBody.style.display = drawerOpen ? 'flex' : 'none';
        chevron.style.transform = drawerOpen ? 'rotate(90deg)' : 'none';
    });

    // Status text
    const statusText = document.createElement('div');
    Object.assign(statusText.style, {
        fontSize: '12px',
        color: t().muted,
        minHeight: '16px'
    });

    // Audio element
    const audioEl = document.createElement('audio');
    audioEl.controls = true;
    audioEl.src = silentBlobUrl;
    Object.assign(audioEl.style, {
        width: '100%',
        borderRadius: '4px'
    });

    // Assemble panel
    panel.appendChild(audioEl);
    panel.appendChild(voiceRow);
    panel.appendChild(customVoiceInput);
    panel.appendChild(drawerToggle);
    panel.appendChild(drawerBody);
    panel.appendChild(statusText);

    document.body.appendChild(panel);
    document.body.appendChild(tab);

    function togglePanel(forceState) {
        panelExpanded = typeof forceState === 'boolean' ? forceState : !panelExpanded;
        panel.style.display = panelExpanded ? 'flex' : 'none';
        tab.style.right = panelExpanded ? '280px' : '0';
    }

    tab.addEventListener('click', () => togglePanel());

    document.addEventListener('click', (e) => {
        if (panelExpanded && !panel.contains(e.target) && !tab.contains(e.target)) {
            togglePanel(false);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panelExpanded) {
            togglePanel(false);
        }
    });

    /* ------------------------------------------------------------------
       PLAYER RESET / FETCH / PLAY-TO-FETCH BRIDGE
       ------------------------------------------------------------------ */
    let isFetching = false;

    function resetPlayer() {
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = null;
        }
        audioEl.src = silentBlobUrl;
        statusText.textContent = '';
    }

    async function doFetch() {
        if (isFetching) return;

        let apiKey = getApiKey();
        if (!apiKey) {
            apiKey = prompt('Enter your OpenRouter API Key:');
            if (!apiKey) return;
            setApiKey(apiKey.trim());
            apiKey = apiKey.trim();
        }

        const customText = textArea.value.trim();
        const text = customText || getPageText();
        if (!text) {
            statusText.textContent = 'No readable text found.';
            return;
        }

        const voice = getVoice();
        const chunks = splitIntoChunks(text, MAX_CHUNK);
        isFetching = true;

        resetPlayer();

        const buffers = [];
        try {
            for (let i = 0; i < chunks.length; i++) {
                statusText.textContent = `Fetching audio ${i + 1} of ${chunks.length}…`;
                const buf = await fetchAudio(chunks[i], apiKey, voice);
                buffers.push(buf);
            }

            const blob = new Blob(buffers, { type: 'audio/mpeg' });
            currentObjectUrl = URL.createObjectURL(blob);
            audioEl.src = currentObjectUrl;
            audioEl.play();
            statusText.textContent = '';
        } catch (err) {
            console.error('[Page Reader]', err);
            statusText.textContent = 'Error: ' + err.message;
        } finally {
            isFetching = false;
        }
    }

    audioEl.addEventListener('play', (e) => {
        if (!currentObjectUrl && !isFetching) {
            audioEl.pause();
            doFetch();
        }
    });

    /* ------------------------------------------------------------------
       LIVE THEME SWITCHING
       ------------------------------------------------------------------ */
    darkMq.addEventListener('change', () => {
        const c = t();
        tab.style.background = c.tabBg;
        panel.style.background = c.panelBg;
        panel.style.color = c.panelText;
        panel.style.boxShadow = c.panelShadow;
        voiceLabel.style.color = c.muted;
        drawerToggle.style.color = c.muted;
        statusText.style.color = c.muted;
        clearLink.style.color = c.muted;
        textArea.style.background = c.textareaBg;
        textArea.style.color = c.panelText;
        textArea.style.borderColor = c.border;
        customVoiceInput.style.background = c.inputBg;
        customVoiceInput.style.color = c.panelText;
        customVoiceInput.style.borderColor = c.border;
        voiceBtns.forEach((b) => {
            const isActive = b.dataset.voice === GM_getValue(VOICE_PREF_KEY, 'female');
            b.style.background = isActive ? ACCENT : c.btnBg;
            b.style.color = isActive ? '#fff' : c.btnText;
            b.style.borderColor = c.border;
        });
    });
})();
