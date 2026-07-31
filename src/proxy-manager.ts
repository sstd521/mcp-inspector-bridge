/**
 * src/proxy-manager.ts
 * 管理 Webview 独立 Session (persist:game-preview) 的网络代理设置
 */
const { session } = require('electron');

/**
 * Webview 代理配置项接口
 */
export interface WebviewProxyConfig {
  /** 代理模式: 'system' 跟随系统, 'direct' 直连, 'custom' 自定义代理 */
  mode: 'system' | 'direct' | 'custom';
  /** 自定义代理服务器地址，如 http://127.0.0.1:8888 或 socks5://127.0.0.1:1080 */
  server?: string;
  /** 是否绕过本地回环地址 (localhost / 127.0.0.1) */
  bypassLocalhost: boolean;
}

/** Webview 独立 Session Partition 名称 */
const PARTITION_NAME = 'persist:game-preview';

/** 当前已保存的代理配置缓存 */
let currentConfig: WebviewProxyConfig = {
  mode: 'system',
  server: '',
  bypassLocalhost: true,
};

/**
 * 将代理配置应用至 Webview Session
 * @param config 代理配置项
 */
export async function applyWebviewProxy(config: WebviewProxyConfig): Promise<void> {
  currentConfig = { ...config };
  const targetSession = session.fromPartition(PARTITION_NAME);

  if (config.mode === 'direct') {
    await targetSession.setProxy({ proxyRules: '' });
  } else if (config.mode === 'system') {
    await targetSession.setProxy({ mode: 'system' });
  } else if (config.mode === 'custom') {
    const bypassRules = config.bypassLocalhost ? 'localhost;127.0.0.1;<loopback>' : '';
    await targetSession.setProxy({
      proxyRules: config.server || '',
      proxyBypassRules: bypassRules,
    });
  }
}

/**
 * 获取当前已保存的代理配置
 * @returns WebviewProxyConfig 当前代理配置对象
 */
export function getWebviewProxyConfig(): WebviewProxyConfig {
  return currentConfig;
}
