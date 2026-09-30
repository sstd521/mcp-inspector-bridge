// @ts-nocheck
import { Logger } from './logger';
import { getCcEngine } from './engine-helper';
export function initRenderDebugger() {
            window.__mcpRenderDebuggerHook = {
                _isActive: false,
                _patches: [],
                _hookEpoch: 0,
                _uiRequestedActive: false,
                _breaks: [],
                _breakSequence: 0,
                _frameSequence: 0,
                _capturePending: null,
                _cancelledCaptures: new Map(),
                _pruneCancelled: function () {
                    const now = Date.now();
                    for (const [id, expiry] of this._cancelledCaptures) if (expiry <= now) this._cancelledCaptures.delete(id);
                    while (this._cancelledCaptures.size > 32) this._cancelledCaptures.delete(this._cancelledCaptures.keys().next().value);
                },
                _engine: null,
                _scene: null,
                _patch: function (target, key, value) {
                    const own = Object.prototype.hasOwnProperty.call(target, key);
                    const original = target[key];
                    const self = this;
                    const epoch = this._hookEpoch;
                    const installed = typeof value === 'function' ? function () {
                        // A third-party wrapper may retain ours after cleanup; old sessions stay inert.
                        if (!self._isActive || self._hookEpoch !== epoch) return typeof original === 'function' ? original.apply(this, arguments) : undefined;
                        return value.apply(this, arguments);
                    } : value;
                    this._patches.push(() => {
                        if (target[key] !== installed) return;
                        if (own) target[key] = original;
                        else delete target[key];
                    });
                    target[key] = installed;
                },
                getSummary: function (options = {}) {
                    if (!options || typeof options !== 'object' || Array.isArray(options)) return { success: false, error: 'INVALID_RENDER_QUERY' };
                    const limit = options.limit === undefined ? 32 : options.limit;
                    if (!Number.isInteger(limit) || limit < 1 || limit > 64) return { success: false, error: 'INVALID_RENDER_QUERY' };
                    const eng = getCcEngine();
                    const scene = eng && eng.director && eng.director.getScene();
                    if (!this._isActive) return { success: true, available: false, active: false, reason: 'RENDER_DEBUGGER_DISABLED' };
                    if (eng !== this._engine || scene !== this._scene) return { success: false, available: false, error: 'RENDER_CONTEXT_CHANGED', verified: false };
                    const short = value => String(value == null ? '' : value).slice(0, 160);
                    const frame = this._frames[this._frames.length - 1];
                    const breaks = this._breaks.filter(item => item.sequence > (options.sinceSequence || 0));
                    return {
                        success: true, available: true, active: true,
                        context: { engineVersion: short(eng.ENGINE_VERSION), sceneUuid: short(scene && (scene.uuid || scene._id)), sceneName: short(scene && scene.name) },
                        frame: frame ? { frameId: frame.frameId, timestamp: frame.timestamp, totalDrawCalls: frame.totalDrawCalls } : null,
                        breaks: breaks.slice(-limit).map(item => ({ sequence: item.sequence, frameId: item.frameId,
                            culprit: short(item.culprit), culpritId: short(item.culpritId), victim: short(item.victim), victimId: short(item.victimId),
                            reasons: item.reasons.slice(0, 4).map(short) })),
                        truncated: breaks.length > limit,
                        capabilities: { batchBreaks: true, drawCalls: !!(this._originDeviceDraw && this._originMainLoop) }
                    };
                },
                captureSummary: async function (options = {}, requestId = '') {
                    if (!options || typeof options !== 'object' || Array.isArray(options) || typeof requestId !== 'string' || requestId.length > 128) return { success: false, error: 'INVALID_RENDER_QUERY' };
                    const durationMs = options.durationMs === undefined ? 200 : options.durationMs;
                    const limit = options.limit === undefined ? 32 : options.limit;
                    if (!Number.isInteger(durationMs) || durationMs < 50 || durationMs > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 64) return { success: false, error: 'INVALID_RENDER_QUERY' };
                    this._pruneCancelled();
                    if (this._cancelledCaptures.has(requestId)) return { success: false, error: 'RENDER_CAPTURE_CANCELLED', verified: false };
                    if (this._capturePending) return { success: false, error: 'RENDER_CAPTURE_BUSY' };
                    const wasActive = this._isActive;
                    const sinceSequence = this._breakSequence;
                    const sinceFrame = this._frameSequence;
                    let timer;
                    let captureEpoch;
                    let cancelled = false;
                    try {
                        const waiting = new Promise(resolve => {
                            timer = setTimeout(resolve, durationMs);
                            this._capturePending = { requestId, cancel: () => { cancelled = true; clearTimeout(timer); resolve(); } };
                        });
                        if (!wasActive) this.injectHooks(true);
                        captureEpoch = this._hookEpoch;
                        if (!this._isActive) return { success: false, available: false, error: 'RENDER_CAPTURE_UNAVAILABLE' };
                        await waiting;
                        if (cancelled) return { success: false, error: 'RENDER_CAPTURE_CANCELLED', verified: false };
                        if (!this._isActive || this._hookEpoch !== captureEpoch) return { success: false, error: 'RENDER_CAPTURE_INTERRUPTED', verified: false };
                        const result = this.getSummary({ limit, sinceSequence });
                        if (result.success && !result.available) return { success: false, error: 'RENDER_CAPTURE_INTERRUPTED', verified: false };
                        result.durationMs = durationMs;
                        result.framesObserved = this._frameSequence - sinceFrame;
                        if (!result.framesObserved) result.frame = null;
                        if (result.success && result.available) result.restoredActive = wasActive || this._uiRequestedActive;
                        return result;
                    } catch (_) { return { success: false, error: 'RENDER_CAPTURE_FAILED', verified: false }; }
                    finally {
                        clearTimeout(timer);
                        this._capturePending = null;
                        if (!wasActive && (captureEpoch === undefined || this._hookEpoch === captureEpoch) && !this._uiRequestedActive) this.restoreHooks();
                    }
                },
                cancelCapture: function (requestId) {
                    if (typeof requestId !== 'string' || !requestId || requestId.length > 128) return false;
                    this._cancelledCaptures.set(requestId, Date.now() + 6000);
                    this._pruneCancelled();
                    if (!this._capturePending || this._capturePending.requestId !== requestId) return false;
                    this._capturePending.cancel();
                    return true;
                },
                _originBatcherAddQuad: null,
                _originPushRenderCommand: null,
                _lastPushedNodeName: "Unknown Node",
                _lastQuadInfo: null,
                _lastBatchNodes: new WeakMap(),

                // --- Frame Snapshot Data ---
                _frames: [],
                _maxFrames: 5,
                _currentFrame: null,
                _isCaptureEnabled: true,
                _originMainLoop: null,
                _originBatcherFlush: null,
                _originDeviceDraw: null,
                _lastSnapshotSendTime: 0,

                // --- 画面重绘回放 ---
                _replayLimit: -1,
                _currentReplayDrawCallCount: 0,
                _requestCaptureThisFrame: false,
                _pendingCommands: [], // 收集发往下一个 DrawCall 的 Command 详情
                _tempBatchesData: [[]], // 存储同步批处理的数据分片
                _currentMcpBatchIndex: 0, // 当前数据分片游标
                _isFlushingBatcher: false,
                _currentFlushingBatchIndex: 0,
                _currentFlushingBatcher: null,

                stepToDrawCall: function (limitIndex: number, frameSnapshotData: any) {
                    this._replayLimit = limitIndex;
                    this._requestCaptureThisFrame = true;
                    // 尝试促使引擎渲染
                    const eng = window.cc || window.editorEngine;
                    if (eng && eng.director && eng.director.isPaused()) {
                        // 强制触发一次绘制以便我们能捕获
                        eng.director.mainLoop(eng.director._deltaTime);
                    }
                },

                injectHooks: function (scopedCapture = false) {
                    const self = this;
                    if (!scopedCapture) self._uiRequestedActive = true;
                    if (self._isActive) return;
                    self._breaks = [];
                    self._lastBatchNodes = new WeakMap();
                    self._hookEpoch++;

                    const eng = getCcEngine();

                    if (!eng || !eng.RenderComponent) {
                        Logger.warn("[RenderDebugger] 初始化失败：未找到 cc.RenderComponent");
                        return;
                    }

                    self._engine = eng;
                    self._scene = eng.director && eng.director.getScene();

                    // Cocos 2.4 引擎真实拼写错误：_checkBacth 而非 _checkBatch
                    const methodName = typeof eng.RenderComponent.prototype._checkBacth === 'function' ? '_checkBacth' : '_checkBatch';

                    if (typeof eng.RenderComponent.prototype[methodName] !== 'function') {
                        Logger.warn(`[RenderDebugger] 无法定位合批检测函数：${methodName}() 不存在`);
                        return;
                    }

                    if (!self._originCheckBatch) {
                        self._originCheckBatch = eng.RenderComponent.prototype[methodName];
                    }

                    self._patch(eng.RenderComponent.prototype, methodName, function (batcher: any, cullingMask: number) {
                        if (self._isActive && batcher) {
                            try {
                                const newMaterial = this._materials && this._materials.length > 0 ? this._materials[0] : null;
                                if (newMaterial && batcher.material) {
                                    const newHash = newMaterial.getHash();
                                    const oldHash = batcher.material.getHash();

                                    if (newHash !== oldHash || batcher.cullingMask !== cullingMask) {
                                        // Standard 2D batches use _dummyNode; retain the actual preceding component.
                                        const previous = self._lastBatchNodes.get(batcher);
                                        const victimNode = batcher.node && batcher.node !== batcher._dummyNode ? batcher.node
                                            : previous && previous.material === batcher.material ? previous.node : null;
                                        if (batcher.material.name !== 'default-material' && victimNode) {
                                            const diffs = [];
                                            if (newMaterial.name !== batcher.material.name) {
                                                diffs.push(`材质实例不同 [${batcher.material.name} -> ${newMaterial.name}]`);
                                            } else if (newHash !== oldHash) {
                                                diffs.push(`材质内部参数变动 (疑似纹理或合批未开)`);
                                            }
                                            if (batcher.cullingMask !== cullingMask) {
                                                diffs.push(`Culling Mask 变动 [${batcher.cullingMask} -> ${cullingMask}]`);
                                            }

                                            const culpritNode = this.node;

                                            const culpritName = culpritNode ? culpritNode.name : 'Unknown';
                                            const victimName = victimNode ? victimNode.name : 'Unknown';
                                            const culpritId = culpritNode ? (culpritNode.uuid || culpritNode.id || '') : '';
                                            const victimId = victimNode ? (victimNode.uuid || victimNode.id || '') : '';

                                            // 完全静默原生控制台，废弃控制台警告直出时代的过渡代码：
                                            // console.warn(\`[RenderDebugger] 🚫 <合批被迫中断> ...\`);

                                            // 阶段一改造：增加前缀 JSON 以向外广播
                                            const payload = {
                                                type: 'render-debugger:batch-break',
                                                data: {
                                                    culprit: culpritName,
                                                    culpritId: culpritId,
                                                    victim: victimName,
                                                    victimId: victimId,
                                                    reasons: diffs
                                                }
                                            };

                                            self._breaks.push({ ...payload.data, sequence: ++self._breakSequence,
                                                frameId: self._currentFrame ? self._currentFrame.frameId : (eng.director.getTotalFrames ? eng.director.getTotalFrames() : null) });
                                            if (self._breaks.length > 128) self._breaks.shift();

                                            // [真正静默模式]：寻找宿主 IPC 专线投递避免污染 Console
                                            if (window.__mcpInspector && window.__mcpInspector.sendRenderDebuggerPayload) {
                                                window.__mcpInspector.sendRenderDebuggerPayload(payload);
                                            } else {
                                                Logger.debug(`[RenderDebugger]JSON_DATA:${JSON.stringify(payload)}`);
                                            }
                                        }
                                    }
                                }
                            } catch (e) { }

                        }
                        const ret = self._originCheckBatch.call(this, batcher, cullingMask);
                        if (batcher) self._lastBatchNodes.set(batcher, { node: this.node, material: batcher.material });

                        // [Phase 4] 收集参与当前正在合批的渲染指令参数
                        if (self._isActive && self._isCaptureEnabled && self._currentFrame) {

                            if (batcher && !batcher.__mcp_execute_hooked) {
                                self._patch(batcher, '__mcp_execute_hooked', true);
                                const hookMethod = function (origFunc) {
                                    if (!origFunc) return origFunc;
                                    return function () {
                                        let ret;
                                        // 标记当前 Batcher 正在排放 DrawCall
                                        if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                                            self._currentFlushingBatcher = this;
                                            this.__mcp_flushing_index = 0;
                                        }
                                        ret = origFunc.apply(this, arguments);
                                        // 排放结束，重置并清空数据
                                        if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                                            if (self._currentFlushingBatcher === this) {
                                                self._currentFlushingBatcher = null;
                                            }
                                            this.__mcp_temp_batches = [];
                                        }
                                        return ret;
                                    };
                                };
                                if (batcher.execute) self._patch(batcher, 'execute', hookMethod(batcher.execute));
                                if (batcher.flush) self._patch(batcher, 'flush', hookMethod(batcher.flush));
                            }

                            let mat = this._materials && this._materials.length > 0 ? this._materials[0] : null;
                            let matHash = mat ? mat.getHash() : 'N/A';
                            let bSrc = mat ? mat.getProperty('blendSrc') : undefined;
                            let bDst = mat ? mat.getProperty('blendDst') : undefined;

                            // 回退拾取：常规组件如果材质取不到则读取组件私有混合模式属性
                            if (bSrc === undefined && this.srcBlendFactor !== undefined) bSrc = this.srcBlendFactor;
                            if (bDst === undefined && this.dstBlendFactor !== undefined) bDst = this.dstBlendFactor;

                            // 嗅探并动态拦截 CC 2.4 所用 Batcher 的各种底层 Flush 变体函数
                            // 只要底层执行了上传派发缓存区，我们就严格闭合当前的组件槽并开启下一个插槽
                            ['flush', '_flush', '_flushIA', '_flushMaterial'].forEach(fn => {
                                if (typeof batcher[fn] === 'function' && !batcher['__mcp_' + fn + '_hooked']) {
                                    self._patch(batcher, '__mcp_' + fn + '_hooked', true);
                                    let oldFn = batcher[fn];
                                    self._patch(batcher, fn, function () {
                                        if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                                            // Guard 验证：防止嵌套 flush 导致越级空包
                                            if (self._tempBatchesData[self._currentMcpBatchIndex] && self._tempBatchesData[self._currentMcpBatchIndex].length > 0) {
                                                self._currentMcpBatchIndex++;
                                                self._tempBatchesData[self._currentMcpBatchIndex] = [];
                                            }
                                        }
                                        return oldFn.apply(this, arguments);
                                    });
                                }
                            });

                            if (typeof self._currentMcpBatchIndex !== 'number') {
                                self._currentMcpBatchIndex = 0;
                            }
                            let targetBatchIndex = self._currentMcpBatchIndex;

                            if (!self._tempBatchesData[targetBatchIndex]) {
                                self._tempBatchesData[targetBatchIndex] = [];
                            }

                            self._tempBatchesData[targetBatchIndex].push({
                                id: self._tempBatchesData[targetBatchIndex].length,
                                type: this.__classname__ || this.constructor.name || 'Component',
                                name: this.node ? this.node.name : 'Unknown',
                                nodeUuid: this.node ? (this.node.uuid || this.node.id) : '',
                                materialHash: matHash,
                                blendSrc: bSrc,
                                blendDst: bDst
                            });
                        }
                        return ret;
                    });

                    // --- 1. mainLoop 钩子 (帧起始/结束) ---
                    if (!self._originMainLoop && eng.Director && eng.Director.prototype.mainLoop) {
                        self._originMainLoop = eng.Director.prototype.mainLoop;
                        self._patch(eng.Director.prototype, 'mainLoop', function (dt: number) {
                            self._lastBatchNodes = new WeakMap();
                            self._currentReplayDrawCallCount = 0; // 起始重置计数

                            if (self._isActive && self._isCaptureEnabled) {
                                self._currentFrame = {
                                    frameId: eng.director.getTotalFrames(),
                                    timestamp: performance.now(),
                                    drawCalls: [],
                                    totalQuads: 0,
                                    totalVertices: 0,
                                    totalDrawCalls: 0
                                };
                                self._pendingCommands = [];
                                self._tempBatchesData = [[]];
                                self._currentMcpBatchIndex = 0;
                                self._isFlushingBatcher = false;
                            }

                            self._originMainLoop.call(this, dt);

                            // 回读截屏 (在原本渲染循环刚完毕尚未交换走 Buffer 时提取)
                            if (self._requestCaptureThisFrame) {
                                self._requestCaptureThisFrame = false;
                                try {
                                    const canvas = document.getElementById('GameCanvas') as HTMLCanvasElement;
                                    if (canvas) {
                                        const base64 = canvas.toDataURL('image/jpeg', 0.8);
                                        const payload = {
                                            type: 'render-debugger:replay-result',
                                            data: base64
                                        };
                                        if (window.__mcpInspector && window.__mcpInspector.sendRenderDebuggerPayload) {
                                            window.__mcpInspector.sendRenderDebuggerPayload(payload);
                                        }
                                    }
                                } catch (err) {
                                    console.error("[RenderDebugger] 画布回读失败: ", err);
                                }
                            }

                            if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                                self._frameSequence++;
                                self._frames.push(self._currentFrame);
                                if (self._frames.length > self._maxFrames) {
                                    self._frames.shift();
                                }

                                // 节流发送快照 (500ms 一次)
                                const now = performance.now();
                                if (!self._lastSnapshotSendTime || now - self._lastSnapshotSendTime > 500) {
                                    self._lastSnapshotSendTime = now;
                                    const payload = {
                                        type: 'render-debugger:snapshot',
                                        data: self._currentFrame
                                    };
                                    if (window.__mcpInspector && window.__mcpInspector.sendRenderDebuggerPayload) {
                                        window.__mcpInspector.sendRenderDebuggerPayload(payload);
                                    } else {
                                        // 兼容降级模式，由宿主主动拦截 console
                                        Logger.debug(`[RenderDebugger]JSON_DATA:${JSON.stringify(payload)}`);
                                    }
                                }

                                self._currentFrame = null;
                            }
                        });
                    }

                    // 废弃对 pushRenderCommand 的旧版本粗粒度拦截（因为我们现在要在 draw 阶段与 checkBacth 中精确挂载 commands）
                    /*
                    if (!self._originPushRenderCommand && eng.renderer) {
                        self._originPushRenderCommand = eng.renderer.pushRenderCommand;
                        eng.renderer.pushRenderCommand = function(cmd: any) {
                            if (self._originPushRenderCommand) {
                                return self._originPushRenderCommand.call(this, cmd);
                            }
                        };
                    }
                    */

                    // --- 3. flush 和 draw 钩子 (最终 DrawCall) ---
                    if (eng.renderer && eng.renderer._batcher) {
                        if (!self._originBatcherFlush) {
                            self._originBatcherFlush = eng.renderer._batcher.flush;
                            self._patch(eng.renderer._batcher, 'flush', function () {
                                let ret;
                                if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                                    self._isFlushingBatcher = true;
                                    self._currentFlushingBatchIndex = 0;
                                }
                                if (self._originBatcherFlush) {
                                    ret = self._originBatcherFlush.apply(this, arguments);
                                }
                                if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                                    self._isFlushingBatcher = false;
                                    // 仅防守，交由具体的 execute/flush hook 清除较为保险，这里也可清
                                    self._tempBatchesData = [];
                                }
                                return ret;
                            });
                        }
                    }

                    // Hook ForwardRenderer._draw to capture exact Item context
                    if (eng.renderer && eng.renderer._forward && eng.renderer._forward.constructor && eng.renderer._forward.constructor.prototype) {
                        if (!self._originForwardDraw) {
                            self._originForwardDraw = eng.renderer._forward.constructor.prototype._draw;
                            if (self._originForwardDraw) {
                                self._patch(eng.renderer._forward.constructor.prototype, '_draw', function (item) {
                                    self._currentRenderItem = item;
                                    let ret = self._originForwardDraw.apply(this, arguments);
                                    self._currentRenderItem = null;
                                    return ret;
                                });
                            }
                        }
                    }

                    if (eng.gfx && eng.gfx.Device) {
                        if (!self._originDeviceDraw) {
                            self._originDeviceDraw = eng.gfx.Device.prototype.draw;
                            self._patch(eng.gfx.Device.prototype, 'draw', function (primitiveType: number, indicesStart: number, indicesCount: number) {

                                // 处理 CC 2.4 中底层重载调用 draw(start, count) 的边界情况
                                let realPrimType = 4; // PT_TRIANGLES 默认为 4
                                let realIndCount = 0;
                                if (arguments.length >= 3) {
                                    realPrimType = arguments[0];
                                    realIndCount = arguments[2];
                                } else if (arguments.length === 2) {
                                    realIndCount = arguments[1];
                                }

                                // 限制回放阶段的超量渲染
                                if (self._replayLimit !== -1) {
                                    if (self._currentReplayDrawCallCount > self._replayLimit) {
                                        self._currentReplayDrawCallCount++;
                                        return; // 跨阶物理抛弃渲染指令
                                    }
                                }
                                if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                                    let activeCommands = [];

                                    // 基于管线的分离式遍历与集中式消费特征：逐批次消费
                                    if (self._tempBatchesData && self._tempBatchesData.length > 0) {
                                        activeCommands = self._tempBatchesData.shift() || [];
                                    }

                                    if (!activeCommands || activeCommands.length === 0) {
                                        activeCommands = self._pendingCommands;
                                        self._pendingCommands = [];

                                        // 兜底策略：如果存在通过 ForwardRenderer._draw 直接派发的 item，解析其从属 Node
                                        if (self._currentRenderItem && activeCommands.length === 0) {
                                            let nodeObj = self._currentRenderItem.node;
                                            if (!nodeObj && self._currentRenderItem.model) {
                                                nodeObj = self._currentRenderItem.model.node;
                                            }
                                            if (nodeObj) {
                                                activeCommands.push({
                                                    id: 0,
                                                    type: 'RenderItem',
                                                    name: nodeObj.name || 'Unknown',
                                                    nodeUuid: nodeObj.uuid || nodeObj.id || ''
                                                });
                                            }
                                        }
                                    }

                                    self._currentFrame.drawCalls.push({
                                        id: self._currentFrame.drawCalls.length,
                                        type: 'draw',
                                        primitiveType: realPrimType,
                                        indiceCount: realIndCount,
                                        vertexCount: Math.floor(realIndCount / 1.5), // 粗略估算四边形的顶点数
                                        timestamp: performance.now(),
                                        commands: activeCommands
                                    });
                                    self._currentFrame.totalDrawCalls++;
                                }

                                self._currentReplayDrawCallCount++;

                                if (self._originDeviceDraw) {
                                    return self._originDeviceDraw.apply(this, arguments);
                                }
                            });
                        }
                    }

                    self._isActive = true;
                    Logger.log("[RenderDebugger] MVP 探针已成功注入游戏内渲染管线 ✅");
                },

                restoreHooks: function () {
                    const self = this;
                    self._uiRequestedActive = false;
                    self._isActive = false;
                    // Restore the original engine, even after the active scene/engine changed.
                    while (self._patches.length) self._patches.pop()();
                    self._originCheckBatch = null;
                    self._originMainLoop = null;
                    self._originPushRenderCommand = null;
                    self._originBatcherFlush = null;
                    self._originDeviceDraw = null;
                    self._originForwardDraw = null;
                    self._engine = null;
                    self._scene = null;
                    self._breaks = [];
                    self._lastQuadInfo = null;
                    self._lastBatchNodes = new WeakMap();
                    self._frames = [];
                    self._currentFrame = null;
                    self._isActive = false;
                    self._replayLimit = -1;
                    self._currentReplayDrawCallCount = 0;
                    self._currentMcpBatchIndex = 0;
                    self._isFlushingBatcher = false;
                    Logger.log("[RenderDebugger] MVP 探针已安全撤出，游戏内归还原生管线 🛑");
                }
            };
}
