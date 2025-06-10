// ==UserScript==
// @name         沈阳师范大学 自动化教务评课脚本 (v4.1 UI修复版)
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  融合多个版本优点，全新悬浮窗UI，修复了核心的评教任务识别逻辑，通过分析页面结构，实现了在课程间自动切换和保存。专为沈阳师范大学优化。
// @author       Gemini (融合重构) / 原作者: Dianachen & 娃伊先森
// @match        https://210-30-208-218.webvpn.synu.edu.cn/*/xsjxpj.aspx*
// @match        https://210-30-208-200.webvpn.synu.edu.cn/*/xsjxpj.aspx*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. 配置与常量 (Configuration & Constants) ---
    const CONFIG = {
        ITEMS_THRESHOLD: 10,  // 当评价项多于此数量时，会选择2个“良好”，否则为1个
        RATING_OPTION_EXCELLENT: 1, // 选项“优秀”的索引 (selectedIndex) 
        RATING_OPTION_GOOD: 2,      // 选项“良好”的索引 (selectedIndex) 
    };

    const SELECTORS = {
        PAGE: {
            // 核心修复：评教任务不再是左侧链接，而是页面内的下拉选择框 
            TASK_DROPDOWN: "#pjkc", // 
            TASK_OPTIONS: "#pjkc > option" // 
        },
        FORM: {
            // 核心修复：选择器更精确，直接定位评教表单内的元素 
            EVALUATION_SELECTS: '#DataGrid1 select[id*="JS1"]', // 
            SAVE_BUTTON: "#Button1", // 
            SUBMIT_ALL_BUTTON: "#Button2", // 
            COMMENT_BOX: "#pjxx" // 
        },
        UI: {
            CONTAINER: "#eval-container",
            FAB: "#eval-fab",
            PANEL: "#eval-panel",
            HEADER: "#eval-header",
            CLOSE_BTN: "#eval-close-btn",
            START_BTN: "#eval-start-btn",
            RESET_BTN: "#eval-reset-btn",
            STATUS_LOG: "#eval-status-log",
            PROGRESS_BAR_FILL: "#eval-progress-bar-fill",
            STATS_DISPLAY: "#eval-stats",
        }
    };

    const STORAGE_KEYS = {
        IS_EVALUATING: "eval_isEvaluating",
        TASK_QUEUE: "eval_taskQueue",
        CURRENT_INDEX: "eval_currentIndex",
        COMPLETED_COUNT: "eval_completedCount"
    };

    // --- 2. 状态管理 (State Management) ---
    const state = {
        taskQueue: [],
        totalTasks: 0,
        currentIndex: 0,
        completedTasks: 0,
        isProcessing: false,
    };

    // --- 3. UI 定义 (UI Definitions) ---
    const uiHTML = `
        <div id="${SELECTORS.UI.CONTAINER.substring(1)}">
            <div id="${SELECTORS.UI.PANEL.substring(1)}" class="hidden">
                <div id="${SELECTORS.UI.HEADER.substring(1)}">
                    <span>🎓 评教助手 v4.1</span>
                    <span id="${SELECTORS.UI.CLOSE_BTN.substring(1)}">✖</span>
                </div>
                <div id="eval-body">
                    <div id="${SELECTORS.UI.STATUS_LOG.substring(1)}">等待指令...</div>
                    <div class="progress-container">
                        <div id="${SELECTORS.UI.PROGRESS_BAR_FILL.substring(1)}"></div>
                    </div>
                    <div id="${SELECTORS.UI.STATS_DISPLAY.substring(1)}">进度: 0 / 0</div>
                    <div class="controls">
                        <button id="${SELECTORS.UI.START_BTN.substring(1)}" class="action-btn">🚀 开始评教</button>
                        <button id="${SELECTORS.UI.RESET_BTN.substring(1)}" class="reset-btn">⏹️ 停止/重置</button>
                    </div>
                </div>
            </div>
            <div id="${SELECTORS.UI.FAB.substring(1)}" title="打开评教助手">
                🎓
            </div>
        </div>`;

    // --- 全面优化的CSS样式 ---
    const uiCSS = `
        #eval-container { position: fixed; bottom: 30px; right: 30px; z-index: 9998; }
        #eval-fab {
            width: 56px; height: 56px; background-color: #0d6efd; color: white;
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
            font-size: 28px; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.2);
            transition: all 0.3s ease; user-select: none;
        }
        #eval-fab:hover { background-color: #0b5ed7; transform: scale(1.1) rotate(15deg); }
        #eval-panel {
            position: absolute; bottom: 70px; right: 0;
            width: 320px; background-color: #ffffff; border: 1px solid #dee2e6;
            border-radius: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.15);
            font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; z-index: 9999; color: #333;
            transform-origin: bottom right;
            transition: transform 0.3s ease, opacity 0.3s ease;
        }
        #eval-panel.hidden { transform: scale(0.5); opacity: 0; pointer-events: none; }
        #eval-header { padding: 12px 15px; background-color: #0d6efd; color: white; border-top-left-radius: 11px; border-top-right-radius: 11px; cursor: move; user-select: none; display: flex; justify-content: space-between; align-items: center; }
        #eval-header span { font-weight: bold; }
        #eval-close-btn { cursor: pointer; font-size: 20px; padding: 0 5px; opacity: 0.8; transition: opacity 0.2s; }
        #eval-close-btn:hover { opacity: 1; }
        #eval-body { padding: 15px; }
        /* 修正：状态日志字体颜色加深，确保可读性 */
        #eval-status-log {
            margin-bottom: 12px; font-size: 14px; min-height: 40px;
            background-color: #f8f9fa; padding: 10px; border-radius: 6px;
            border: 1px solid #e9ecef; text-align: center;
            color: #343a40; /* 使用更深的颜色 */
        }
        .progress-container { width: 100%; background-color: #e9ecef; border-radius: 8px; overflow: hidden; margin-bottom: 8px; height: 16px; }
        #eval-progress-bar-fill { width: 0%; height: 100%; background-color: #198754; transition: width 0.4s ease-in-out; text-align: center; color: white; line-height: 16px; font-size: 12px; font-weight: bold; }
        #eval-stats { text-align: right; font-size: 12px; color: #6c757d; margin-bottom: 15px; }
        .controls { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; align-items: center; }
        /* 修正：按钮统一样式，并使用flex修正对齐问题 */
        .action-btn, .reset-btn {
            color: #ffffff !important; /* 统一白色字体 */
            border: none !important;
            padding: 10px 15px !important;
            border-radius: 8px !important;
            cursor: pointer !important;
            font-size: 16px !important;
            font-weight: bold;
            transition: all 0.2s ease !important;
            display: flex; /* 关键：使用Flexbox修正内容对齐 */
            align-items: center; /* 垂直居中 */
            justify-content: center; /* 水平居中 */
            gap: 8px; /* 为可能的图标和文本提供间距 */
        }
        /* 修正：更新按钮颜色方案 */
        .action-btn { background-color: #198754 !important; } /* 开始按钮：活力绿 */
        .action-btn:hover:not(:disabled) { background-color: #157347 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
        .action-btn:active:not(:disabled) { transform: scale(0.97); }

        .reset-btn { background-color: #dc3545 !important; font-size: 14px !important; } /* 停止按钮：警示红 */
        .reset-btn:hover:not(:disabled) { background-color: #c82333 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .reset-btn:active:not(:disabled) { transform: scale(0.97); }

        /* 修正：通过降低不透明度来处理禁用状态，解决字体颜色看不清的问题 */
        .action-btn:disabled, .reset-btn:disabled {
            background-color: #cccccc !important;
            cursor: not-allowed !important;
            opacity: 0.7;
        }
    `;

    // --- 4. DOM 元素缓存 (DOM Element Cache) ---
    const dom = {};

    // --- 5. 工具函数 (Utility Functions) ---
    function updateUI(message, progress, stats) {
        if (dom.statusLog && message !== null) dom.statusLog.textContent = message;
        if (dom.progressBarFill && progress !== null) {
            dom.progressBarFill.style.width = `${progress}%`;
            dom.progressBarFill.textContent = `${Math.round(progress)}%`;
        }
        if (dom.statsDisplay && stats !== null) dom.statsDisplay.textContent = stats;
    }

    // --- 6. 核心逻辑函数 (Core Logic Functions) ---

    function fillEvaluationForm() {
        const selects = document.querySelectorAll(SELECTORS.FORM.EVALUATION_SELECTS);
        if (selects.length === 0) {
            throw new Error("在当前页面未找到任何评教选项(Selects)。");
        }
        selects.forEach(s => s.selectedIndex = CONFIG.RATING_OPTION_EXCELLENT);
        const numOfGoodRatings = selects.length > CONFIG.ITEMS_THRESHOLD ? 2 : 1;
        const randomIndexes = new Set();
        while (randomIndexes.size < numOfGoodRatings && randomIndexes.size < selects.length) {
            randomIndexes.add(Math.floor(Math.random() * selects.length));
        }
        randomIndexes.forEach(index => selects[index].selectedIndex = CONFIG.RATING_OPTION_GOOD);
        const commentBox = document.querySelector(SELECTORS.FORM.COMMENT_BOX);
        if (commentBox) {
            const comments = ["老师讲课生动有趣，内容充实，收获很大！", "非常喜欢老师的教学风格。", "老师备课充分，治学严谨，感谢老师的付出。", "这是一门很有价值的课程。"];
            commentBox.value = comments[Math.floor(Math.random() * comments.length)];
        }
    }

    async function processCurrentTask() {
        const currentCourseValue = state.taskQueue[state.currentIndex];
        const dropdown = document.querySelector(SELECTORS.PAGE.TASK_DROPDOWN);

        if (dropdown.value !== currentCourseValue) {
            updateUI(`切换到课程: ${dropdown.options[state.currentIndex].text}...`, (state.completedTasks / state.totalTasks) * 100, `进度: ${state.completedTasks} / ${state.totalTasks}`);
            dropdown.value = currentCourseValue;
            dropdown.dispatchEvent(new Event('change', { bubbles: true }));
            return;
        }

        try {
            updateUI(`正在评价: ${dropdown.options[dropdown.selectedIndex].text}`, (state.completedTasks / state.totalTasks) * 100, `进度: ${state.completedTasks} / ${state.totalTasks}`);
            fillEvaluationForm();
            await GM_setValue(STORAGE_KEYS.COMPLETED_COUNT, state.completedTasks + 1);
            const saveButton = document.querySelector(SELECTORS.FORM.SAVE_BUTTON);
            if (!saveButton || saveButton.disabled) {
                 throw new Error("“保存”按钮未找到或被禁用。");
            }
            saveButton.click();
        } catch (error) {
            console.error("评价过程中出错:", error);
            updateUI(`❌ 错误: ${error.message}`, null, null);
            await resetEvaluation();
        }
    }

    async function startEvaluation() {
        if (state.isProcessing) return;
        const taskOptions = document.querySelectorAll(SELECTORS.PAGE.TASK_OPTIONS);
        if (!taskOptions || taskOptions.length === 0) {
            updateUI("❌ 未在本页检测到待评价课程。", 0, "进度: 0 / 0");
            return;
        }
        dom.startBtn.disabled = true;
        dom.resetBtn.disabled = false;
        state.isProcessing = true;
        const taskQueue = Array.from(taskOptions).map(opt => opt.value);
        const currentIndex = document.querySelector(SELECTORS.PAGE.TASK_DROPDOWN).selectedIndex;
        await GM_setValue(STORAGE_KEYS.IS_EVALUATING, true);
        await GM_setValue(STORAGE_KEYS.TASK_QUEUE, JSON.stringify(taskQueue));
        await GM_setValue(STORAGE_KEYS.CURRENT_INDEX, currentIndex);
        await GM_setValue(STORAGE_KEYS.COMPLETED_COUNT, 0);
        await loadStateAndContinue();
    }

    async function resetEvaluation() {
        await GM_deleteValue(STORAGE_KEYS.IS_EVALUATING);
        await GM_deleteValue(STORAGE_KEYS.TASK_QUEUE);
        await GM_deleteValue(STORAGE_KEYS.CURRENT_INDEX);
        await GM_deleteValue(STORAGE_KEYS.COMPLETED_COUNT);
        state.isProcessing = false;
        updateUI("评教已停止/重置。", 0, "进度: 0 / 0");
        dom.startBtn.disabled = false;
        dom.startBtn.textContent = "🚀 开始评教";
        dom.resetBtn.disabled = true;
    }

    async function loadStateAndContinue() {
        state.isProcessing = await GM_getValue(STORAGE_KEYS.IS_EVALUATING, false);
        if (!state.isProcessing) {
            updateUI("等待指令...", 0, "进度: 0 / 0");
            dom.resetBtn.disabled = true;
            return;
        }
        const storedQueue = await GM_getValue(STORAGE_KEYS.TASK_QUEUE, "[]");
        state.taskQueue = JSON.parse(storedQueue);
        state.totalTasks = state.taskQueue.length;
        state.currentIndex = document.querySelector(SELECTORS.PAGE.TASK_DROPDOWN).selectedIndex;
        state.completedTasks = await GM_getValue(STORAGE_KEYS.COMPLETED_COUNT, 0);
        dom.startBtn.disabled = true;
        dom.resetBtn.disabled = false;
        if (state.completedTasks >= state.totalTasks) {
            updateUI("🎉 全部评价完成！请手动点击“提交”按钮。", 100, `进度: ${state.totalTasks} / ${state.totalTasks}`);
            const submitBtn = document.querySelector(SELECTORS.FORM.SUBMIT_ALL_BUTTON);
            if (submitBtn) {
                submitBtn.style.cssText = 'border: 3px solid red !important; transform: scale(1.1); background-color: #dc3545 !important;';
                submitBtn.disabled = false;
            }
            await resetEvaluation();
            dom.startBtn.textContent = "✅ 已完成";
        } else {
            await processCurrentTask();
        }
    }

    // --- 7. UI 设置与事件监听 (UI Setup & Event Listeners) ---
    function addEventListeners() {
        dom.fab.onclick = () => dom.panel.classList.toggle('hidden');
        dom.closeBtn.onclick = () => dom.panel.classList.add('hidden');
        dom.startBtn.onclick = startEvaluation;
        dom.resetBtn.onclick = resetEvaluation;
        let isDragging = false, offset = { x: 0, y: 0 };
        dom.header.onmousedown = (e) => {
            isDragging = true;
            const panelRect = dom.panel.getBoundingClientRect();
            offset = {
                x: e.clientX - panelRect.left,
                y: e.clientY - panelRect.top
            };
            document.body.style.userSelect = 'none';
        };
        document.onmousemove = (e) => {
            if (!isDragging) return;
            const newX = e.clientX - offset.x;
            const newY = e.clientY - offset.y;
            dom.panel.style.position = 'fixed';
            dom.panel.style.left = `${newX}px`;
            dom.panel.style.top = `${newY}px`;
            dom.panel.style.bottom = 'auto';
            dom.panel.style.right = 'auto';
        };
        document.onmouseup = () => {
            isDragging = false;
            document.body.style.userSelect = 'auto';
        };
    }

    function setupUI() {
        GM_addStyle(uiCSS);
        document.body.insertAdjacentHTML('beforeend', uiHTML);
        Object.keys(SELECTORS.UI).forEach(key => {
            dom[key.toLowerCase().replace(/_([a-z])/g, g => g[1].toUpperCase())] = document.querySelector(SELECTORS.UI[key]);
        });
    }

    // --- 8. 初始化 (Initialization) ---
    function init() {
        if (document.querySelector(SELECTORS.UI.CONTAINER)) return;
        try {
            setupUI();
            addEventListeners();
            loadStateAndContinue();
        } catch (error) {
            console.error('自动评教助手初始化失败:', error);
            alert('自动评教助手初始化失败，请按 F12 查看控制台获取更多信息。');
        }
    }

    init();

})();
