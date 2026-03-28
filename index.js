/*
 * Click-to-Speak Extension for SillyTavern
 * 点击发音插件 - 支持英语/德语离线TTS
 * 使用浏览器内置 Web Speech API，无需联网
 */

(function () {
    // ============ 扩展基本信息 ============
    const extensionName = "SillyTavern-ClickToSpeak";
    const extensionFolderPath = `scripts/extensions/third_party/${extensionName}`;

    // ============ 默认设置 ============
    const defaultSettings = {
        enabled: true,
        language: "auto",      // "auto", "en", "de"
        speechRate: 1.0,
        speechPitch: 1.0,
        speechVolume: 1.0,
        clickMode: "word",     // "word" = 单词, "sentence" = 整句
        voiceEN: "",           // 英语语音名称
        voiceDE: "",           // 德语语音名称
        highlightOnHover: true,
        showReadButton: true,  // 显示整句朗读按钮
    };

    // ============ 全局变量 ============
    let availableVoices = [];
    let englishVoices = [];
    let germanVoices = [];
    let isProcessingMessages = false;
    let tooltip = null;
    let currentUtterance = null;

    // ============ 工具函数 ============

    /**
     * 检测文本语言 (简单启发式)
     */
    function detectLanguage(text) {
        if (!text || text.trim().length === 0) return "en";

        const cleanText = text.toLowerCase().trim();

        // 德语特征字符
        const germanChars = /[äöüßÄÖÜ]/;
        if (germanChars.test(cleanText)) return "de";

        // 常见德语单词
        const germanWords = [
            'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
            'der', 'die', 'das', 'ein', 'eine', 'einer',
            'und', 'oder', 'aber', 'wenn', 'weil', 'dass',
            'ist', 'sind', 'war', 'hat', 'haben', 'wird',
            'nicht', 'kein', 'keine', 'mit', 'von', 'für',
            'auf', 'aus', 'bei', 'nach', 'über', 'unter',
            'zwischen', 'durch', 'gegen', 'ohne', 'um',
            'noch', 'schon', 'auch', 'nur', 'sehr', 'viel',
            'gut', 'schlecht', 'groß', 'klein', 'neu', 'alt',
            'ja', 'nein', 'bitte', 'danke', 'hallo', 'tschüss',
            'was', 'wer', 'wo', 'wie', 'warum', 'wann',
            'mein', 'dein', 'sein', 'ihr', 'unser', 'euer',
            'kann', 'muss', 'soll', 'will', 'darf', 'mag',
            'gehen', 'kommen', 'machen', 'sagen', 'geben',
            'nehmen', 'sehen', 'finden', 'denken', 'wissen',
            'leben', 'lieben', 'spielen', 'arbeiten', 'lernen',
            'haus', 'mann', 'frau', 'kind', 'zeit', 'tag',
            'nacht', 'welt', 'stadt', 'land', 'wasser',
            'heute', 'morgen', 'gestern', 'immer', 'nie',
            'hier', 'dort', 'oben', 'unten', 'links', 'rechts',
            'jetzt', 'dann', 'zuerst', 'endlich', 'plötzlich',
            'alles', 'nichts', 'etwas', 'jemand', 'niemand'
        ];

        const words = cleanText.split(/\s+/);
        let germanScore = 0;
        let totalChecked = 0;

        for (const word of words) {
            const clean = word.replace(/[^a-zäöüß]/g, '');
            if (clean.length < 2) continue;
            totalChecked++;
            if (germanWords.includes(clean)) {
                germanScore++;
            }
        }

        // 德语常见字母组合
        const germanPatterns = [
            /sch/i, /ch(?!r)/i, /ck/i, /tz/i, /ei/i,
            /eu/i, /au/i, /ie(?!d)/i, /ung$/i, /keit$/i,
            /heit$/i, /lich$/i, /isch$/i, /eur$/i
        ];

        let patternScore = 0;
        for (const pattern of germanPatterns) {
            if (pattern.test(cleanText)) patternScore++;
        }

        if (totalChecked > 0 && (germanScore / totalChecked) > 0.15) return "de";
        if (patternScore >= 3) return "de";

        return "en";
    }

    /**
     * 加载可用语音
     */
    function loadVoices() {
        return new Promise((resolve) => {
            const voices = speechSynthesis.getVoices();
            if (voices.length > 0) {
                processVoices(voices);
                resolve(voices);
                return;
            }

            speechSynthesis.onvoiceschanged = () => {
                const v = speechSynthesis.getVoices();
                processVoices(v);
                resolve(v);
            };

            // 超时保护
            setTimeout(() => {
                const v = speechSynthesis.getVoices();
                processVoices(v);
                resolve(v);
            }, 3000);
        });
    }

    function processVoices(voices) {
        availableVoices = voices;
        englishVoices = voices.filter(v =>
            v.lang.startsWith('en')
        );
        germanVoices = voices.filter(v =>
            v.lang.startsWith('de')
        );
        console.log(`[ClickToSpeak] 找到语音: 英语 ${englishVoices.length}个, 德语 ${germanVoices.length}个`);
        updateVoiceSelectors();
    }

    /**
     * 获取最佳语音
     */
    function getBestVoice(lang) {
        const settings = getSettings();
        let voices, preferredName;

        if (lang === "de") {
            voices = germanVoices;
            preferredName = settings.voiceDE;
        } else {
            voices = englishVoices;
            preferredName = settings.voiceEN;
        }

        // 优先用户选择的
        if (preferredName) {
            const found = voices.find(v => v.name === preferredName);
            if (found) return found;
        }

        // 优先离线语音
        const offline = voices.filter(v => v.localService);
        if (offline.length > 0) return offline[0];

        // 任何可用语音
        if (voices.length > 0) return voices[0];

        // 最后回退
        return null;
    }

    /**
     * 朗读文本
     */
    function speakText(text, forceLang) {
        if (!text || text.trim().length === 0) return;

        // 停止之前的朗读
        speechSynthesis.cancel();

        const settings = getSettings();
        const lang = forceLang || (settings.language === "auto" ? detectLanguage(text) : settings.language);

        const utterance = new SpeechSynthesisUtterance(text.trim());
        utterance.rate = settings.speechRate;
        utterance.pitch = settings.speechPitch;
        utterance.volume = settings.speechVolume;

        const voice = getBestVoice(lang);
        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        } else {
            utterance.lang = lang === "de" ? "de-DE" : "en-US";
        }

        utterance.onstart = () => {
            currentUtterance = utterance;
            showTooltip(`🔊 ${lang === 'de' ? 'DE' : 'EN'}: ${text}`, null);
        };

        utterance.onend = () => {
            currentUtterance = null;
            hideTooltip();
            document.querySelectorAll('.cts-word-speaking').forEach(el => {
                el.classList.remove('cts-word-speaking');
            });
            document.querySelectorAll('.cts-read-msg-btn.cts-speaking').forEach(el => {
                el.classList.remove('cts-speaking');
            });
        };

        utterance.onerror = (e) => {
            currentUtterance = null;
            hideTooltip();
            if (e.error !== 'canceled') {
                console.warn('[ClickToSpeak] 语音错误:', e.error);
            }
        };

        // Chrome长文本bug修复
        if (text.length > 200) {
            setupChromeFix(utterance);
        }

        speechSynthesis.speak(utterance);
    }

    /**
     * Chrome长文本朗读中断修复
     */
    function setupChromeFix(utterance) {
        let fixInterval;
        utterance.onstart = () => {
            fixInterval = setInterval(() => {
                if (speechSynthesis.speaking && !speechSynthesis.paused) {
                    speechSynthesis.pause();
                    speechSynthesis.resume();
                }
            }, 10000);
        };
        const originalOnEnd = utterance.onend;
        utterance.onend = () => {
            clearInterval(fixInterval);
            if (originalOnEnd) originalOnEnd();
        };
        const originalOnError = utterance.onerror;
        utterance.onerror = (e) => {
            clearInterval(fixInterval);
            if (originalOnError) originalOnError(e);
        };
    }

    /**
     * 停止朗读
     */
    function stopSpeaking() {
        speechSynthesis.cancel();
        currentUtterance = null;
        hideTooltip();
        document.querySelectorAll('.cts-word-speaking').forEach(el => {
            el.classList.remove('cts-word-speaking');
        });
        document.querySelectorAll('.cts-read-msg-btn.cts-speaking').forEach(el => {
            el.classList.remove('cts-speaking');
        });
    }

    // ============ 浮动提示 ============

    function createTooltip() {
        if (tooltip) return;
        tooltip = document.createElement('div');
        tooltip.className = 'cts-tooltip';
        tooltip.style.opacity = '0';
        tooltip.style.display = 'none';
        document.body.appendChild(tooltip);
    }

    function showTooltip(text, targetEl) {
        if (!tooltip) createTooltip();
        tooltip.textContent = text;
        tooltip.style.display = 'block';

        if (targetEl) {
            const rect = targetEl.getBoundingClientRect();
            tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
            tooltip.style.top = `${rect.top - tooltip.offsetHeight - 8}px`;
        } else {
            tooltip.style.left = '50%';
            tooltip.style.top = '20px';
            tooltip.style.transform = 'translateX(-50%)';
        }

        tooltip.style.opacity = '1';
        setTimeout(() => hideTooltip(), 2500);
    }

    function hideTooltip() {
        if (!tooltip) return;
        tooltip.style.opacity = '0';
        setTimeout(() => {
            if (tooltip) tooltip.style.display = 'none';
        }, 200);
    }

    // ============ 消息处理 ============

    /**
     * 将消息文本中的单词包装为可点击元素
     */
    function wrapWordsInMessage(messageEl) {
        if (!messageEl || messageEl.dataset.ctsProcessed === 'true') return;

        const settings = getSettings();
        if (!settings.enabled) return;

        messageEl.dataset.ctsProcessed = 'true';

        // 获取所有文本节点所在的元素
        const textElements = messageEl.querySelectorAll('.mes_text');

        textElements.forEach(textEl => {
            if (textEl.dataset.ctsWrapped === 'true') return;
            textEl.dataset.ctsWrapped = 'true';

            processTextNode(textEl);

            // 添加整句朗读按钮
            if (settings.showReadButton) {
                addReadButton(textEl);
            }
        });
    }

    function processTextNode(element) {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null,
            false
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.trim().length > 0 &&
                !node.parentElement.classList.contains('cts-word-wrap') &&
                !node.parentElement.closest('.cts-read-msg-btn')) {
                textNodes.push(node);
            }
        }

        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            // 按单词和空格/标点分割
            const parts = text.match(/[\w\u00C0-\u024F\u00DF']+|[^\w\u00C0-\u024F\u00DF']+/gu);

            if (!parts || parts.length <= 1) {
                // 如果整个都是一个单词
                if (/[\w\u00C0-\u024F\u00DF]/.test(text)) {
                    const span = document.createElement('span');
                    span.className = 'cts-word-wrap';
                    span.textContent = text;
                    span.addEventListener('click', onWordClick);
                    span.addEventListener('touchend', onWordTouch);
                    textNode.parentNode.replaceChild(span, textNode);
                }
                return;
            }

            const fragment = document.createDocumentFragment();
            parts.forEach(part => {
                if (/[\w\u00C0-\u024F\u00DF]/.test(part)) {
                    const span = document.createElement('span');
                    span.className = 'cts-word-wrap';
                    span.textContent = part;
                    span.addEventListener('click', onWordClick);
                    span.addEventListener('touchend', onWordTouch);
                    fragment.appendChild(span);
                } else {
                    fragment.appendChild(document.createTextNode(part));
                }
            });

            textNode.parentNode.replaceChild(fragment, textNode);
        });
    }

    /**
     * 添加整句朗读按钮
     */
    function addReadButton(textEl) {
        if (textEl.querySelector('.cts-read-msg-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'cts-read-msg-btn';
        btn.innerHTML = '🔊';
        btn.title = '朗读整段文本';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            if (btn.classList.contains('cts-speaking')) {
                stopSpeaking();
                return;
            }

            const fullText = textEl.textContent.replace(/🔊/g, '').trim();
            if (fullText) {
                btn.classList.add('cts-speaking');
                speakText(fullText);
            }
        });

        // 插入到文本区域的开头
        textEl.insertBefore(btn, textEl.firstChild);
    }

    /**
     * 单词点击事件(PC)
     */
    function onWordClick(e) {
        e.stopPropagation();
        e.preventDefault();

        const settings = getSettings();
        if (!settings.enabled) return;

        const word = e.target.textContent.trim();
        if (!word) return;

        // 添加朗读中高亮
        document.querySelectorAll('.cts-word-speaking').forEach(el => {
            el.classList.remove('cts-word-speaking');
        });
        e.target.classList.add('cts-word-speaking');

        if (settings.clickMode === 'sentence') {
            // 朗读整句
            const parentMesText = e.target.closest('.mes_text');
            if (parentMesText) {
                const fullText = parentMesText.textContent.replace(/🔊/g, '').trim();
                speakText(fullText);
            }
        } else {
            speakText(word);
        }

        showTooltip(`🔊 ${word}`, e.target);
    }

    /**
     * 单词触摸事件(手机)
     */
    function onWordTouch(e) {
        // 防止触发两次
        e.preventDefault();
        onWordClick(e);
    }

    // ============ 设置管理 ============

    function getSettings() {
        if (!window.extension_settings) {
            window.extension_settings = {};
        }
        if (!window.extension_settings[extensionName]) {
            window.extension_settings[extensionName] = Object.assign({}, defaultSettings);
        }
        return window.extension_settings[extensionName];
    }

    function saveSettings() {
        if (typeof context !== 'undefined' && context.saveSettingsDebounced) {
            context.saveSettingsDebounced();
        }
    }

    // ============ UI面板 ============

    function createSettingsPanel() {
        const html = `
        <div id="click-to-speak-panel" class="extension_settings">
            <h4>🔊 Click to Speak (EN/DE)</h4>
            <small style="color:var(--SmartThemeQuoteColor);">点击单词即可发音 - 支持英语和德语</small>
            <hr>

            <!-- 总开关 -->
            <div class="cts-control-row">
                <label>功能开关:</label>
                <button id="cts-toggle" class="cts-toggle-btn cts-on">✅ 已开启</button>
                <span class="cts-status-indicator">
                    <span id="cts-status-dot" class="cts-status-dot cts-active"></span>
                    <span id="cts-status-text">运行中</span>
                </span>
            </div>

            <!-- 语言选择 -->
            <div class="cts-control-row">
                <label>语言模式:</label>
                <select id="cts-language">
                    <option value="auto">🌐 自动检测</option>
                    <option value="en">🇬🇧 仅英语</option>
                    <option value="de">🇩🇪 仅德语</option>
                </select>
            </div>

            <!-- 点击模式 -->
            <div class="cts-control-row">
                <label>点击模式:</label>
                <div class="cts-mode-tabs">
                    <button class="cts-mode-tab cts-mode-active" data-mode="word">📝 单词</button>
                    <button class="cts-mode-tab" data-mode="sentence">📄 整句</button>
                </div>
            </div>

            <!-- 英语语音选择 -->
            <div class="cts-control-row">
                <label>🇬🇧 英语音:</label>
                <select id="cts-voice-en">
                    <option value="">自动选择</option>
                </select>
                <button class="cts-test-btn" id="cts-test-en">测试</button>
            </div>

            <!-- 德语语音选择 -->
            <div class="cts-control-row">
                <label>🇩🇪 德语音:</label>
                <select id="cts-voice-de">
                    <option value="">自动选择</option>
                </select>
                <button class="cts-test-btn" id="cts-test-de">测试</button>
            </div>

            <!-- 语速 -->
            <div class="cts-control-row">
                <label>语速:</label>
                <input type="range" id="cts-rate" min="0.3" max="2.0" step="0.1" value="1.0">
                <span class="cts-value-display" id="cts-rate-value">1.0</span>
            </div>

            <!-- 音调 -->
            <div class="cts-control-row">
                <label>音调:</label>
                <input type="range" id="cts-pitch" min="0.5" max="2.0" step="0.1" value="1.0">
                <span class="cts-value-display" id="cts-pitch-value">1.0</span>
            </div>

            <!-- 音量 -->
            <div class="cts-control-row">
                <label>音量:</label>
                <input type="range" id="cts-volume" min="0" max="1" step="0.1" value="1.0">
                <span class="cts-value-display" id="cts-volume-value">1.0</span>
            </div>

            <!-- 显示朗读按钮 -->
            <div class="cts-control-row">
                <label>整句按钮:</label>
                <button id="cts-show-read-btn" class="cts-toggle-btn cts-on">显示🔊</button>
            </div>

            <hr>

            <!-- 操作按钮 -->
            <div class="cts-control-row">
                <button class="cts-stop-btn" id="cts-stop-all">⏹ 停止朗读</button>
                <button class="cts-test-btn" id="cts-refresh-msgs">🔄 刷新消息</button>
            </div>

            <!-- 语音信息 -->
            <div class="cts-voice-info" id="cts-voice-info">
                正在加载语音引擎...
            </div>
        </div>`;

        // 将面板添加到扩展设置区域
        const container = document.getElementById('extensions_settings2') ||
                          document.getElementById('extensions_settings');
        if (container) {
            container.insertAdjacentHTML('beforeend', html);
        }

        bindPanelEvents();
    }

    function bindPanelEvents() {
        const settings = getSettings();

        // 总开关
        const toggleBtn = document.getElementById('cts-toggle');
        if (toggleBtn) {
            updateToggleBtn(toggleBtn, settings.enabled);
            toggleBtn.addEventListener('click', () => {
                settings.enabled = !settings.enabled;
                updateToggleBtn(toggleBtn, settings.enabled);
                updateStatusIndicator(settings.enabled);
                saveSettings();
                if (settings.enabled) {
                    processAllMessages();
                }
            });
        }

        // 语言选择
        const langSelect = document.getElementById('cts-language');
        if (langSelect) {
            langSelect.value = settings.language;
            langSelect.addEventListener('change', () => {
                settings.language = langSelect.value;
                saveSettings();
            });
        }

        // 点击模式
        document.querySelectorAll('.cts-mode-tab').forEach(tab => {
            if (tab.dataset.mode === settings.clickMode) {
                tab.classList.add('cts-mode-active');
            } else {
                tab.classList.remove('cts-mode-active');
            }
            tab.addEventListener('click', () => {
                document.querySelectorAll('.cts-mode-tab').forEach(t =>
                    t.classList.remove('cts-mode-active'));
                tab.classList.add('cts-mode-active');
                settings.clickMode = tab.dataset.mode;
                saveSettings();
            });
        });

        // 语速
        const rateSlider = document.getElementById('cts-rate');
        const rateValue = document.getElementById('cts-rate-value');
        if (rateSlider) {
            rateSlider.value = settings.speechRate;
            rateValue.textContent = settings.speechRate;
            rateSlider.addEventListener('input', () => {
                settings.speechRate = parseFloat(rateSlider.value);
                rateValue.textContent = settings.speechRate.toFixed(1);
                saveSettings();
            });
        }

        // 音调
        const pitchSlider = document.getElementById('cts-pitch');
        const pitchValue = document.getElementById('cts-pitch-value');
        if (pitchSlider) {
            pitchSlider.value = settings.speechPitch;
            pitchValue.textContent = settings.speechPitch;
            pitchSlider.addEventListener('input', () => {
                settings.speechPitch = parseFloat(pitchSlider.value);
                pitchValue.textContent = settings.speechPitch.toFixed(1);
                saveSettings();
            });
        }

        // 音量
        const volumeSlider = document.getElementById('cts-volume');
        const volumeValue = document.getElementById('cts-volume-value');
        if (volumeSlider) {
            volumeSlider.value = settings.speechVolume;
            volumeValue.textContent = settings.speechVolume;
            volumeSlider.addEventListener('input', () => {
                settings.speechVolume = parseFloat(volumeSlider.value);
                volumeValue.textContent = settings.speechVolume.toFixed(1);
                saveSettings();
            });
        }

        // 测试英语
        document.getElementById('cts-test-en')?.addEventListener('click', () => {
            speakText("Hello! This is a test of the English voice.", "en");
        });

        // 测试德语
        document.getElementById('cts-test-de')?.addEventListener('click', () => {
            speakText("Hallo! Dies ist ein Test der deutschen Stimme.", "de");
        });

        // 英语语音选择
        document.getElementById('cts-voice-en')?.addEventListener('change', (e) => {
            settings.voiceEN = e.target.value;
            saveSettings();
        });

        // 德语语音选择
        document.getElementById('cts-voice-de')?.addEventListener('change', (e) => {
            settings.voiceDE = e.target.value;
            saveSettings();
        });

        // 停止朗读
        document.getElementById('cts-stop-all')?.addEventListener('click', stopSpeaking);

        // 刷新消息
        document.getElementById('cts-refresh-msgs')?.addEventListener('click', () => {
            resetAllMessages();
            processAllMessages();
        });

        // 显示朗读按钮开关
        const readBtnToggle = document.getElementById('cts-show-read-btn');
        if (readBtnToggle) {
            updateToggleBtn(readBtnToggle, settings.showReadButton, '显示🔊', '隐藏🔊');
            readBtnToggle.addEventListener('click', () => {
                settings.showReadButton = !settings.showReadButton;
                updateToggleBtn(readBtnToggle, settings.showReadButton, '显示🔊', '隐藏🔊');
                saveSettings();
                resetAllMessages();
                processAllMessages();
            });
        }

        updateStatusIndicator(settings.enabled);
    }

    function updateToggleBtn(btn, isOn, onText, offText) {
        if (isOn) {
            btn.classList.remove('cts-off');
            btn.classList.add('cts-on');
            btn.textContent = onText || '✅ 已开启';
        } else {
            btn.classList.remove('cts-on');
            btn.classList.add('cts-off');
            btn.textContent = offText || '❌ 已关闭';
        }
    }

    function updateStatusIndicator(isActive) {
        const dot = document.getElementById('cts-status-dot');
        const text = document.getElementById('cts-status-text');
        if (dot) {
            dot.className = `cts-status-dot ${isActive ? 'cts-active' : 'cts-inactive'}`;
        }
        if (text) {
            text.textContent = isActive ? '运行中' : '已停止';
        }
    }

    function updateVoiceSelectors() {
        const settings = getSettings();

        // 英语语音列表
        const enSelect = document.getElementById('cts-voice-en');
        if (enSelect) {
            const currentVal = settings.voiceEN;
            enSelect.innerHTML = '<option value="">自动选择</option>';
            englishVoices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.name;
                opt.textContent = `${v.name} (${v.lang})${v.localService ? ' [离线]' : ''}`;
                if (v.name === currentVal) opt.selected = true;
                enSelect.appendChild(opt);
            });
        }

        // 德语语音列表
        const deSelect = document.getElementById('cts-voice-de');
        if (deSelect) {
            const currentVal = settings.voiceDE;
            deSelect.innerHTML = '<option value="">自动选择</option>';
            germanVoices.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.name;
                opt.textContent = `${v.name} (${v.lang})${v.localService ? ' [离线]' : ''}`;
                if (v.name === currentVal) opt.selected = true;
                deSelect.appendChild(opt);
            });
        }

        // 更新信息面板
        const info = document.getElementById('cts-voice-info');
        if (info) {
            const offlineEN = englishVoices.filter(v => v.localService).length;
            const offlineDE = germanVoices.filter(v => v.localService).length;
            info.innerHTML = `✅ 语音引擎就绪<br>` +
                `🇬🇧 英语: ${englishVoices.length}个语音 (${offlineEN}个离线)<br>` +
                `🇩🇪 德语: ${germanVoices.length}个语音 (${offlineDE}个离线)<br>` +
                `💡 离线语音无需联网即可使用`;
        }
    }

    // ============ 消息观察 ============

    function processAllMessages() {
        const settings = getSettings();
        if (!settings.enabled) return;

        const messages = document.querySelectorAll('.mes');
        messages.forEach(msg => wrapWordsInMessage(msg));
    }

    function resetAllMessages() {
        document.querySelectorAll('[data-cts-processed]').forEach(el => {
            delete el.dataset.ctsProcessed;
        });
        document.querySelectorAll('[data-cts-wrapped]').forEach(el => {
            delete el.dataset.ctsWrapped;
        });
        // 移除包装 (重新加载时会重新处理)
        document.querySelectorAll('.cts-word-wrap').forEach(span => {
            const text = document.createTextNode(span.textContent);
            span.parentNode.replaceChild(text, span);
        });
        document.querySelectorAll('.cts-read-msg-btn').forEach(btn => btn.remove());
    }

    /**
     * 使用MutationObserver监听新消息
     */
    function setupMessageObserver() {
        const chatContainer = document.getElementById('chat');
        if (!chatContainer) {
            console.warn('[ClickToSpeak] 未找到聊天容器，5秒后重试...');
            setTimeout(setupMessageObserver, 5000);
            return;
        }

        const observer = new MutationObserver((mutations) => {
            const settings = getSettings();
            if (!settings.enabled) return;

            let hasNewMessages = false;

            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.classList?.contains('mes')) {
                            wrapWordsInMessage(node);
                            hasNewMessages = true;
                        }
                        // 也处理子节点中的消息
                        node.querySelectorAll?.('.mes')?.forEach(msg => {
                            wrapWordsInMessage(msg);
                            hasNewMessages = true;
                        });
                    }
                });

                // 处理内容变化（流式输出）
                if (mutation.type === 'characterData' || mutation.type === 'childList') {
                    const mesText = mutation.target.closest?.('.mes_text') ||
                                   mutation.target.parentElement?.closest?.('.mes_text');
                    if (mesText && mesText.dataset.ctsWrapped === 'true') {
                        // 流式输出时延迟重新处理
                        clearTimeout(mesText._ctsTimeout);
                        mesText._ctsTimeout = setTimeout(() => {
                            delete mesText.dataset.ctsWrapped;
                            const mes = mesText.closest('.mes');
                            if (mes) {
                                delete mes.dataset.ctsProcessed;
                                wrapWordsInMessage(mes);
                            }
                        }, 500);
                    }
                }
            });
        });

        observer.observe(chatContainer, {
            childList: true,
            subtree: true,
            characterData: true
        });

        console.log('[ClickToSpeak] 消息观察器已启动');
    }

    // ============ 初始化 ============

    async function init() {
        console.log('[ClickToSpeak] 插件初始化中...');

        // 确保设置存在
        getSettings();

        // 创建提示框
        createTooltip();

        // 加载语音
        await loadVoices();

        // 创建设置面板
        createSettingsPanel();

        // 设置消息观察器
        setTimeout(() => {
            setupMessageObserver();
            processAllMessages();
        }, 2000);

        // 定期检查新消息（作为备用）
        setInterval(() => {
            const settings = getSettings();
            if (settings.enabled) {
                const unprocessed = document.querySelectorAll('.mes:not([data-cts-processed])');
                unprocessed.forEach(msg => wrapWordsInMessage(msg));
            }
        }, 3000);

        console.log('[ClickToSpeak] ✅ 插件初始化完成!');
    }

    // ============ 启动 ============

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
    } else {
        setTimeout(init, 1500);
    }

})();
