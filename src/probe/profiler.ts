// @ts-nocheck
import { getCcEngine } from './engine-helper';

export function initProfiler() {
    let lastFrames = 0;
    let lastTime = Date.now();
    let currentFps = 0;

    // 维护一个平滑窗口计算毫秒数
    let accumulatedLogicTime = 0;
    let accumulatedRenderTime = 0;
    let logicFrames = 0;
    let renderFrames = 0;

    let logicStart = 0;
    let renderStart = 0;

    // 帧时间环形缓冲区（≈10 秒窗口 @60fps），用于百分位计算
    const FRAME_TIME_WINDOW = 600;
    const frameDeltas: number[] = [];
    let lastFrameTime = 0;

    let isEventsHooked = false;
    function tryHookDirectorEvents() {
        if (isEventsHooked) return;
        const ccEng = getCcEngine();
        if (!ccEng || !ccEng.director) return;
        isEventsHooked = true;

        lastFrames = ccEng.director.getTotalFrames ? ccEng.director.getTotalFrames() : 0;

        // 实时逻辑消耗窃听器
        ccEng.director.on(ccEng.Director.EVENT_BEFORE_UPDATE, () => {
            logicStart = performance.now();
            // 记录帧间间隔
            if (lastFrameTime > 0) {
                const delta = logicStart - lastFrameTime;
                frameDeltas.push(delta);
                if (frameDeltas.length > FRAME_TIME_WINDOW) frameDeltas.shift();
            }
            lastFrameTime = logicStart;
        });
        ccEng.director.on(ccEng.Director.EVENT_AFTER_UPDATE, () => {
            accumulatedLogicTime += (performance.now() - logicStart);
            logicFrames++;
        });

        // 实时渲染消耗窃听器
        ccEng.director.on(ccEng.Director.EVENT_BEFORE_DRAW, () => {
            renderStart = performance.now();
        });
        ccEng.director.on(ccEng.Director.EVENT_AFTER_DRAW, () => {
            accumulatedRenderTime += (performance.now() - renderStart);
            renderFrames++;
        });
    }

    tryHookDirectorEvents();

    // 缓存给主进程轮询拿的变量
    let displayLogicTime = 0;
    let displayRenderTime = 0;

    setInterval(() => {
        tryHookDirectorEvents();
        const ccEng = getCcEngine();
        if (!ccEng || !ccEng.director) return;

        const now = Date.now();
        const frames = ccEng.director.getTotalFrames ? ccEng.director.getTotalFrames() : 0;
        const dt = (now - lastTime) / 1000;
        if (dt > 0) {
            currentFps = Math.max(0, Math.round((frames - lastFrames) / dt));
        }
        lastTime = now;
        lastFrames = frames;

        // 平滑计算平均耗时，保留 2 位小数
        displayLogicTime = logicFrames > 0 ? Number((accumulatedLogicTime / logicFrames).toFixed(2)) : 0;
        displayRenderTime = renderFrames > 0 ? Number((accumulatedRenderTime / renderFrames).toFixed(2)) : 0;

        // 重置累加器
        accumulatedLogicTime = 0;
        logicFrames = 0;
        accumulatedRenderTime = 0;
        renderFrames = 0;

    }, 500); // 也是 500ms，和 FPS 一起刷新平滑

    window.__mcpProfilerTick = function () {
        // 读取 DrawCall: 它是单帧即时数据，可以直接拿 renderer 的
        let drawCall = 0;
        const ccEng = getCcEngine();

        try {
            if (ccEng && ccEng.renderer && typeof ccEng.renderer.drawCalls !== 'undefined') {
                drawCall = ccEng.renderer.drawCalls;
            } else if (ccEng && ccEng.profiler_stats) {
                drawCall = ccEng.profiler_stats.drawCall || 0;
            }
        } catch (e) { }

        // 计算帧率分位统计
        let avgFps = 0, fps1pLow = 0, fps01pLow = 0;
        if (frameDeltas.length > 30) {
            const sorted = [...frameDeltas].sort((a, b) => a - b);
            const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
            avgFps = Math.round(1000 / avg * 10) / 10;
            const idx99 = Math.min(Math.ceil(sorted.length * 0.99) - 1, sorted.length - 1);
            const idx999 = Math.min(Math.ceil(sorted.length * 0.999) - 1, sorted.length - 1);
            fps1pLow = Math.round(1000 / Math.max(sorted[idx99], 0.1));
            fps01pLow = Math.round(1000 / Math.max(sorted[idx999], 0.1));
        }

        return {
            fps: currentFps,
            avgFps: avgFps,
            fps1pLow: fps1pLow,
            fps01pLow: fps01pLow,
            drawCall: drawCall,
            logicTime: displayLogicTime,
            renderTime: displayRenderTime
        };
    };

    window.__mcpCountNodes = function () {
        const ccEng = getCcEngine();
        const scene = ccEng ? ccEng.director.getScene() : null;
        if (!scene) return 0;
        function count(node: any): number {
            let n = 1;
            if (node.children) {
                for (let i = 0; i < node.children.length; i++) {
                    n += count(node.children[i]);
                }
            }
            return n;
        }
        return count(scene);
    };
}
