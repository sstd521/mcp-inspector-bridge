// @ts-nocheck
/**
 * 引擎实例查找器
 * 兼容 Preview 模式（直接挂在 window.cc）与 Build 模式（可能挂在 window.cc、iframe#GameDiv 或 window.frames 内）
 */
export function getCcEngine(): any {
    if (typeof window === 'undefined') return null;

    // 1. 优先检测当前全局 window.cc
    if ((window as any).cc && (window as any).cc.director) {
        return (window as any).cc;
    }

    // 2. 检测 typeof cc 变量
    if (typeof cc !== 'undefined' && cc && cc.director) {
        (window as any).cc = cc;
        return cc;
    }

    // 3. 检测 iframe#GameDiv 容器 (Cocos 2.4.x 某些模板)
    try {
        const gameDiv = document.getElementById('GameDiv') as HTMLIFrameElement | null;
        if (gameDiv && (gameDiv as any).contentWindow && (gameDiv as any).contentWindow.cc && (gameDiv as any).contentWindow.cc.director) {
            const iframeCc = (gameDiv as any).contentWindow.cc;
            (window as any).cc = iframeCc;
            return iframeCc;
        }
    } catch (e) {}

    // 4. 遍历所有子框架 window.frames
    try {
        if (window.frames && window.frames.length > 0) {
            for (let i = 0; i < window.frames.length; i++) {
                try {
                    const frameCc = (window.frames[i] as any).cc;
                    if (frameCc && frameCc.director) {
                        (window as any).cc = frameCc;
                        return frameCc;
                    }
                } catch (e) {}
            }
        }
    } catch (e) {}

    return null;
}

export function safeGetCcEngine(): any {
    try {
        if (typeof getCcEngine === 'function') return getCcEngine();
    } catch (e) {}
    if (typeof window !== 'undefined') {
        if (typeof (window as any).getCcEngine === 'function') return (window as any).getCcEngine();
        if (typeof (window as any).__mcpGetCcEngine === 'function') return (window as any).__mcpGetCcEngine();
        if ((window as any).cc && (window as any).cc.director) return (window as any).cc;
    }
    if (typeof cc !== 'undefined' && cc && cc.director) return cc;
    return null;
}

// 保证挂载到全局 window 作用域，防止闭包内调用引发 ReferenceError
if (typeof window !== 'undefined') {
    (window as any).getCcEngine = getCcEngine;
    (window as any).__mcpGetCcEngine = getCcEngine;
    (window as any).safeGetCcEngine = safeGetCcEngine;
}
