'use strict';

/**
 * 中国联通话费、语音、流量仪表盘（清透磨砂玻璃 UI 版）
 *
 * 自动获取方式：
 * 1. 打开中国联通 App，进入首页查询一次余额/套餐
 * 2. Egern 自动捕获联通 App 请求中的 Cookie 和手机号
 *
 * 三种用法（同一个 JS）：
 * http_request → 自动抓 Cookie / 手机号
 * generic      → 显示 Widget
 * schedule     → 保活：定时请求接口续期 Session 并刷新缓存
 */

const API_HOST = 'm.client.10010.com';
const API_URL =
  'https://m.client.10010.com/mobileserviceimportant/home/queryUserInfoSeven';
const FLOW_DETAIL_URL =
  'https://m.client.10010.com/servicequerybusiness/operationservice/queryOcsPackageFlowLeftContentRevisedInJune';

const KEY = 'ChinaUnicomHark';

const C = {
  // 低饱和环境渐变 + 统一中性色玻璃；主题色只用于图标、关键数字和进度。
  fee: '#E28A16',
  flow: '#079ACB',
  voice: '#8B5CF6',
  // 文本色随系统外观自动切换，避免深色模式下深色文字落在深色玻璃上。
  txt: { light: '#172B45', dark: '#F3F7FC' },
  sub: { light: '#586D84', dark: '#B8C7D8' },
  title: '#0F9F91',
  cyan: '#22B8CF',
  violet: '#9B7BFF',
  pink: '#EC6FA7',
  green: '#27A879',
  glass: { light: '#FFFFFFD9', dark: '#263D55D9' },
  glassBorder: { light: '#FFFFFF70', dark: '#FFFFFF25' },
  glassShadow: { light: '#64748B06', dark: '#00000000' },
};

const transparentMode = false;

function broadnetBackgroundGradient() {
  if (transparentMode) return undefined;
  return {
    type: 'radial',
    colors: [
      { light: '#BFEAFF', dark: '#193B60' },
      { light: '#E7D9FF', dark: '#3C2E63' },
      { light: '#C8F7E6', dark: '#174D48' },
    ],
    stops: [0, 0.55, 1],
    center: { x: 0.22, y: 0.12 },
    startRadius: 0,
    endRadius: 520,
  };
}

/* =========================================================
 * 工具函数与格式化
 * ========================================================= */

function getRequestHeader(headers, name) {
  if (!headers) return '';
  try {
    if (typeof headers.get === 'function') {
      return headers.get(name) || '';
    }
  } catch (e) {}
  try {
    for (const key of Object.keys(headers)) {
      if (String(key).toLowerCase() === name.toLowerCase()) {
        return headers[key] || '';
      }
    }
  } catch (e) {}
  return '';
}

function extractPhone(url) {
  if (!url) return '';
  try {
    const match = url.match(/[?&]desmobiel=([^&]+)/i);
    if (match && match[1]) {
      return decodeURIComponent(match[1]).trim();
    }
  } catch (e) {}
  return '';
}

function calcPlanPercent(total, used, remain) {
  const t = Number(total);
  const u = Number(used);
  const r = Number(remain);

  if (Number.isFinite(t) && t > 0 && Number.isFinite(u) && u >= 0) {
    return Math.max(0, Math.min(1, u / t));
  }
  if (Number.isFinite(t) && t > 0 && Number.isFinite(r) && r >= 0) {
    return Math.max(0, Math.min(1, 1 - r / t));
  }
  return null;
}

function formatFee(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '--';
}

function formatFlow(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return { number: '--', unit: 'GB' };

  // 内部统一转化为 KB 进行 1024 进制换算，保证总量、已用、剩余及历史记录显示一致。
  const gb = 1024 * 1024;
  const mb = 1024;
  if (n >= gb) return { number: (n / gb).toFixed(2), unit: 'GB' };
  if (n >= mb) return { number: (n / mb).toFixed(2), unit: 'MB' };
  if (n >= 1) return { number: n.toFixed(2), unit: 'KB' };
  return { number: (n * 1024).toFixed(2), unit: 'B' };
}

function formatVoice(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(0) : '--';
}

function toFlowKB(value, unit) {
  const v = parseFloat(value);
  if (!Number.isFinite(v)) return null;
  const u = String(unit || 'MB').toUpperCase();
  if (u === 'GB' || u === 'G') return v * 1024 * 1024;
  if (u === 'KB' || u === 'K') return v;
  if (u === 'B') return v / 1024;
  return v * 1024;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '刚刚';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return '刚刚';
  if (totalMin < 60) return totalMin + '分';
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (hours < 24) return hours + '小时' + (remMin > 0 ? remMin + '分' : '');
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return days + '天' + (remHours > 0 ? remHours + '小时' : '');
}

function fmtTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes());
}

function saveHistory(ctx, flowKB) {
  try {
    const old = ctx.storage.getJSON(KEY + '.history') || [];
    const n = Number(flowKB);
    if (!Number.isFinite(n)) return old;

    const now = Date.now();
    const next = old.filter(x => now - Number(x.ts) < 7 * 86400000);
    const last = next[next.length - 1];
    if (!last || now - Number(last.ts) >= 25 * 60 * 1000 || Number(last.flowKB) !== n) {
      next.push({ ts: now, flowKB: n });
    }
    const trimmed = next.slice(-24);
    ctx.storage.setJSON(KEY + '.history', trimmed);
    return trimmed;
  } catch (e) {
    return [];
  }
}

/* =========================================================
 * Cookie / 手机号捕获
 * ========================================================= */

async function handleCapture(ctx) {
  if (ctx.env && String(ctx.env.cuCapture).toLowerCase() === 'false') {
    return;
  }

  const req = ctx.request || {};
  const url = String(req.url || '');
  if (!url || !url.includes(API_HOST)) return;

  const cookie = String(getRequestHeader(req.headers, 'cookie') || '').trim();
  const phone = extractPhone(url);

  let changed = false;

  if (cookie) {
    const oldCookie = ctx.storage.get('unicom_cookie') || '';
    if (cookie !== oldCookie) {
      ctx.storage.set('unicom_cookie', cookie);
      changed = true;
    }
  }

  if (phone) {
    const oldPhone = ctx.storage.get('unicom_phone') || '';
    if (phone !== oldPhone) {
      ctx.storage.set('unicom_phone', phone);
      changed = true;
    }
  }

  if (changed && cookie && phone) {
    ctx.storage.set(KEY + '.captureTime', String(Date.now()));
    if ((!ctx.env || String(ctx.env.cuCaptureNotice).toLowerCase() !== 'false') &&
        typeof ctx.notify === 'function') {
      ctx.notify({
        title: '中国联通数据捕获成功',
        body: '已自动获取登录信息，正在查询套餐接口',
        sound: false,
      });
    }
  }
}

/* =========================================================
 * 数据请求与解析
 * ========================================================= */

async function fetchUnicomData(ctx, cookie, phone) {
  const url =
    `${API_URL}?version=iphone_c@10.0100` +
    `&desmobiel=${encodeURIComponent(phone)}` +
    `&showType=0`;

  const resp = await ctx.http.get(url, {
    timeout: 10000,
    headers: {
      Host: API_HOST,
      'User-Agent': 'ChinaUnicom.x CFNetwork iOS/16.3',
      Cookie: cookie,
    },
    credentials: 'omit',
  }).catch(e => {
    e.transient = true;
    throw e;
  });

  if (!resp) {
    const e = new Error('no-response');
    e.transient = true;
    throw e;
  }

  if (resp.status === 401 || resp.status === 403) {
    const e = new Error(`HTTP ${resp.status}`);
    e.authFailed = true;
    throw e;
  }

  if (resp.status !== 200) {
    throw new Error(`HTTP ${resp.status}`);
  }

  return await resp.json();
}

async function fetchFlowDetail(ctx, cookie) {
  const resp = await ctx.http.post(FLOW_DETAIL_URL, {
    timeout: 10000,
    headers: {
      Host: API_HOST,
      'User-Agent': 'ChinaUnicom.x CFNetwork iOS/16.3',
      Cookie: cookie,
    },
    credentials: 'omit',
  });

  if (!resp || resp.status !== 200) {
    throw new Error(`HTTP ${resp ? resp.status : 'no-response'}`);
  }

  const data = await resp.json();
  if (!data || String(data.code) !== '0000') {
    throw new Error(`API 返回异常：${data?.code || 'unknown'}`);
  }

  // 打印完整的明细数据结构，用于核对字段
  console.log('[ChinaUnicom] 流量明细原始数据: ' + JSON.stringify(data));

  return data;
}

const FLOW_RESOURCE_NAMES = {
  resources: '套餐内流量&流量包',
  unshared: '套餐内流量&流量包(非共享)',
  rzbresources: '日租宝',
  mlresources: '免流流量',
  twresources: '套外流量',
};

function isDirectionalFlowItem(item, resourceName) {
  const addupItemCode = String(item.addupItemCode || '');
  const addUpItemName = String(item.addUpItemName || '');
  const feePolicyName = String(item.feePolicyName || '');

  return (
    addupItemCode === '40008' ||
    addUpItemName === '套餐内专享免费流量' ||
    resourceName === '免流流量' ||
    /（免流）|畅视/.test(feePolicyName)
  );
}

/**
 * 校验并过滤掉语音、短信等非流量项，避免语音分钟数被当成流量累加
 */
function isNonFlowItem(item, res) {
  const unit = String(item.unit || item.measureUnit || '').trim();
  const name = String(item.addUpItemName || item.feePolicyName || '').trim();
  const rType = String(res.type || item.resourceType || item.elemType || '').toUpperCase();

  // 1. 单位包含分钟、分、次、条、元，或名称包含语音/通话，一律按非流量处理
  if (/分钟|分|次|条|元|min|语音|通话|主叫/i.test(unit + name)) return true;
  // 2. 根据资源类型标识过滤语音/短信标识
  if (rType.includes('VOICE') || rType.includes('SMS') || rType === '1' || rType === '2') {
    if (!/MB|GB|KB|流量/i.test(unit + name)) return true;
  }

  return false;
}

function parseFlowDetail(data) {
  let generalRemain = 0;
  let directionalRemain = 0;
  let generalTotal = 0;
  let directionalTotal = 0;
  let generalUsed = 0;
  let directionalUsed = 0;
  let otherRemain = 0;
  let otherTotal = 0;
  let otherUsed = 0;
  const debugItems = [];

  for (const key of Object.keys(FLOW_RESOURCE_NAMES)) {
    const resourceName = FLOW_RESOURCE_NAMES[key];
    const list = data[key];
    if (!Array.isArray(list)) continue;

    for (const res of list) {
      const details = res.details;
      if (!Array.isArray(details)) continue;

      for (const item of details) {
        const unit = String(item.unit || item.measureUnit || '');
        const itemName = String(item.addUpItemName || item.feePolicyName || '');
        const remain = Math.max(0, parseFloat(item.remain) || 0);
        const total = Math.max(0, parseFloat(item.total) || 0);
        const used = Math.max(0, parseFloat(item.use) || 0);

        debugItems.push({ name: itemName, unit, total, remain, used });

        // 核心修复：如果是语音或非流量包，直接跳过，不参与流量累加！
        if (isNonFlowItem(item, res)) {
          continue;
        }

        const directional = isDirectionalFlowItem(item, resourceName);

        if (directional) {
          directionalRemain += remain;
          directionalTotal += total;
          directionalUsed += used;
        } else if (key === 'rzbresources' || key === 'twresources') {
          // 日租宝 / 套餐外流量 → 其它流量
          otherRemain += remain;
          otherTotal += total;
          otherUsed += used;
        } else {
          generalRemain += remain;
          generalTotal += total;
          generalUsed += used;
        }
      }
    }
  }

  // 打印日志，可在 Egern 中查看过滤明细
  console.log('[ChinaUnicom] 流量明细解析过滤检查: ' + JSON.stringify(debugItems));

  return {
    generalRemain,
    directionalRemain,
    generalTotal,
    directionalTotal,
    generalUsed,
    directionalUsed,
    otherRemain,
    otherTotal,
    otherUsed,
  };
}

function notifyExpiredOnce(ctx, cookie) {
  const key = 'unicom_expired_notified';
  const marker = cookie || 'none';
  if (ctx.storage.get(key) === marker) return;
  ctx.storage.set(key, marker);
  try {
    ctx.notify({
      title: '中国联通',
      body: '登录已过期，请重新打开联通 App 获取登录信息',
    });
  } catch (e) {}
}

function clearExpiredFlag(ctx) {
  try {
    ctx.storage.remove('unicom_expired_notified');
  } catch (e) {}
}

function normalizeLegacyCache(cached, captureDuration) {
  if (!cached || typeof cached !== 'object') return null;
  if (cached.fee && cached.fee.number !== undefined && cached.flow && cached.flow.number !== undefined) {
    cached.captureDuration = captureDuration;
    return cached;
  }
  return {
    stale: true,
    fee: {
      title: cached.fee?.title || '剩余话费',
      number: formatFee(cached.fee?.value ?? cached.fee?.number),
      unit: cached.fee?.unit || '元',
    },
    flow: {
      title: cached.flow?.title || '剩余流量',
      number: String(cached.flow?.value ?? cached.flow?.number ?? '--'),
      unit: cached.flow?.unit || 'MB',
    },
    voice: {
      title: cached.voice?.title || '剩余语音',
      number: formatVoice(cached.voice?.value ?? cached.voice?.number),
      unit: cached.voice?.unit || '分钟',
    },
    updatedAt: cached.updatedAt || cached.timestamp || Date.now(),
    captureDuration,
    history: cached.history || [],
    plan: cached.plan || {},
  };
}

async function loadData(ctx, forceRefresh) {
  const cookie = ctx.storage.get('unicom_cookie') || '';
  const phone = ctx.storage.get('unicom_phone') || '';

  const currentCaptureTime = String(ctx.storage.get(KEY + '.captureTime') || '');
  const captureTs = Number(currentCaptureTime || 0);
  const captureDuration = captureTs > 0 ? formatDuration(Date.now() - captureTs) : '';

  if (ctx.env && String(ctx.env.cuCapture).toLowerCase() === 'false') {
    const rawCached = ctx.storage.getJSON(KEY + '.datasource') || ctx.storage.getJSON('unicom_datasource');
    const cached = normalizeLegacyCache(rawCached, captureDuration);
    if (cached) cached.stale = true;
    return { configured: !!cached, data: cached, fromCache: true, captureDisabled: true };
  }

  if (!cookie || !phone) {
    return { configured: false, data: null, fromCache: false };
  }

  const CACHE_TTL = 15 * 60 * 1000;
  const rawCached = ctx.storage.getJSON(KEY + '.datasource') || ctx.storage.getJSON('unicom_datasource');
  const cachedData = normalizeLegacyCache(rawCached, captureDuration);
  const queriedCaptureTime = String(ctx.storage.get(KEY + '.queriedCaptureTime') || '');
  const cachedAt = Number(cachedData && cachedData.updatedAt || 0);
  const cacheAge = cachedAt > 0 ? Date.now() - cachedAt : Number.POSITIVE_INFINITY;
  const hasNewCapture = Boolean(currentCaptureTime && currentCaptureTime !== queriedCaptureTime);

  if (!forceRefresh && cachedData && !hasNewCapture && cacheAge >= 0 && cacheAge < CACHE_TTL) {
    cachedData.stale = false;
    cachedData.captureDuration = captureDuration;
    return { configured: true, data: cachedData, fromCache: true };
  }

  const lastAttemptAt = Number(ctx.storage.get(KEY + '.lastAttemptAt') || 0);
  const attemptAge = Date.now() - lastAttemptAt;
  if (!forceRefresh && cachedData && !hasNewCapture && lastAttemptAt > 0 &&
      attemptAge >= 0 && attemptAge < 15000) {
    cachedData.stale = true;
    cachedData.captureDuration = captureDuration;
    return { configured: true, data: cachedData, fromCache: true };
  }

  if (!forceRefresh && cachedData && !hasNewCapture && cacheAge >= CACHE_TTL) {
    cachedData.stale = true;
    cachedData.captureDuration = captureDuration;
    ctx.storage.set(KEY + '.lastAttemptAt', String(Date.now()));
    loadData(ctx, true).catch(() => {});
    return { configured: true, data: cachedData, fromCache: true };
  }

  try {
    ctx.storage.set(KEY + '.lastAttemptAt', String(Date.now()));
    const res = await fetchUnicomData(ctx, cookie, phone);

    if (!res || res.code !== 'Y' || !res.feeResource || !res.voiceResource || !res.flowResource) {
      throw new Error(`API 返回异常：${res?.code || 'unknown'}`);
    }

    const feeRaw = res.feeResource.feePersent ?? 0;
    const voiceRemain = Number(res.voiceResource.voicePersent ?? 0);
    const voiceTotal = res.voiceResource.voiceTotal != null ? Number(res.voiceResource.voiceTotal) : null;
    const voiceUsed = res.voiceResource.voiceUsed != null ? Number(res.voiceResource.voiceUsed) : null;

    let flowRemainKB = toFlowKB(res.flowResource.flowPersent ?? 0, res.flowResource.newUnit || 'MB');
    let flowTotalKB = null;
    let flowUsedKB = null;

    const showGeneralFlow = !ctx.env || ctx.env.CU_SHOW_GENERAL_FLOW !== 'false';
    const showDirectionalFlow = !ctx.env || ctx.env.CU_SHOW_DIRECTIONAL_FLOW !== 'false';
    const showOtherFlow = !ctx.env || ctx.env.CU_SHOW_OTHER_FLOW !== 'false';

    let flowBreakdown = null;

    try {
      const detail = await fetchFlowDetail(ctx, cookie);
      const parsed = parseFlowDetail(detail);

      let remainMB = 0;
      let totalMB = 0;
      let usedMB = 0;

      // 三分类：专属 / 通用 / 其它（parseFlowDetail 返回值单位为 MB）
      const flowCats = [
        { key: 'general', show: showGeneralFlow },
        { key: 'directional', show: showDirectionalFlow },
        { key: 'other', show: showOtherFlow },
      ];

      flowBreakdown = {};

      for (const c of flowCats) {
        const r = parsed[c.key + 'Remain'] || 0;
        const t = parsed[c.key + 'Total'] || 0;
        const u = parsed[c.key + 'Used'] || 0;
        flowBreakdown[c.key] = {
          remain: r * 1024,
          total: t > 0 ? t * 1024 : null,
          used: t > 0 || u > 0 ? u * 1024 : null,
          percent: calcPlanPercent(t * 1024, u * 1024, r * 1024),
        };
        if (c.show) {
          remainMB += r;
          totalMB += t;
          usedMB += u;
        }
      }

      if (totalMB <= 0 && (remainMB > 0 || usedMB > 0)) {
        totalMB = remainMB + usedMB;
      }

      flowRemainKB = remainMB * 1024;
      flowTotalKB = totalMB > 0 ? totalMB * 1024 : null;
      flowUsedKB = (totalMB > 0 || usedMB > 0) ? usedMB * 1024 : null;
    } catch (e) {}

    const flowFormatted = formatFlow(flowRemainKB);
    const flowPercent = calcPlanPercent(flowTotalKB, flowUsedKB, flowRemainKB);
    const voicePercent = calcPlanPercent(voiceTotal, voiceUsed, voiceRemain);
    const history = saveHistory(ctx, flowRemainKB);

    const ds = {
      stale: false,
      fee: {
        title: res.feeResource.dynamicFeeTitle || '剩余话费',
        number: formatFee(feeRaw),
        unit: res.feeResource.newUnit || '元',
      },
      flow: {
        title: res.flowResource.dynamicFlowTitle || '剩余流量',
        number: flowFormatted.number,
        unit: flowFormatted.unit,
      },
      voice: {
        title: res.voiceResource.dynamicVoiceTitle || '剩余语音',
        number: formatVoice(voiceRemain),
        unit: res.voiceResource.newUnit || '分钟',
      },
      updatedAt: Date.now(),
      captureDuration,
      history,
      flowBreakdown,
      plan: {
        total: flowTotalKB,
        used: flowUsedKB,
        remain: flowRemainKB,
        percent: flowPercent,
        voiceTotal,
        voiceUsed,
        voiceRemain,
        voicePercent,
      },
    };

    ctx.storage.setJSON(KEY + '.datasource', ds);
    ctx.storage.setJSON('unicom_datasource', ds);
    if (currentCaptureTime) {
      ctx.storage.set(KEY + '.queriedCaptureTime', currentCaptureTime);
    }
    clearExpiredFlag(ctx);

    const notifiedCaptureTime = String(ctx.storage.get(KEY + '.notifiedCaptureTime') || '');
    if (currentCaptureTime && currentCaptureTime !== notifiedCaptureTime) {
      if ((!ctx.env || String(ctx.env.cuPlanNotice).toLowerCase() !== 'false') &&
          typeof ctx.notify === 'function') {
        const totalFlowText = formatFlow(flowTotalKB);
        const usedFlowText = formatFlow(flowUsedKB);
        const remainFlowText = formatFlow(flowRemainKB);
        const body = [
          '剩余话费：¥' + formatFee(feeRaw),
          '流量：已用 ' + usedFlowText.number + ' ' + usedFlowText.unit +
            ' / 总量 ' + totalFlowText.number + ' ' + totalFlowText.unit,
          '剩余流量：' + remainFlowText.number + ' ' + remainFlowText.unit,
          '剩余语音：' + formatVoice(voiceRemain) + ' 分钟',
        ].join('\n');
        ctx.notify({
          title: '中国联通套餐查询成功',
          body,
          sound: false,
        });
      }
      ctx.storage.set(KEY + '.notifiedCaptureTime', currentCaptureTime);
    }

    return { configured: true, data: ds, fromCache: false };
  } catch (e) {
    if (e && e.authFailed) {
      notifyExpiredOnce(ctx, cookie);
    }
    if (cachedData) cachedData.stale = true;
    return {
      configured: true,
      data: cachedData || null,
      fromCache: true,
      error: e,
    };
  }
}

/* =========================================================
 * 保活模式（schedule 定时任务调用）
 * ========================================================= */

function parseKeepAliveInterval(value) {
  const raw = String(value == null ? '20' : value).trim();
  if (!/^[0-9]+$/.test(raw)) return 20 * 60 * 1000;
  const minutes = Number(raw);
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return 20 * 60 * 1000;
  return Math.max(15 * 60 * 1000, Math.min(24 * 60 * 60 * 1000, minutes * 60 * 1000));
}

async function handleKeepAlive(ctx) {
  const env = ctx && ctx.env ? ctx.env : {};
  const intervalText = env.cuKeepaliveInterval == null ? '20' : env.cuKeepaliveInterval;
  const intervalMs = parseKeepAliveInterval(intervalText);
  const forceManual = String(env.CU_KEEPALIVE_FORCE || '').toLowerCase() === 'true';
  const lastRun = Number(ctx.storage.get(KEY + '.keepAliveLastRun') || 0);
  const now = Date.now();

  if (!forceManual && lastRun && now - lastRun < intervalMs) {
    return;
  }

  const cookie = ctx.storage.get('unicom_cookie') || '';
  const phone = ctx.storage.get('unicom_phone') || '';
  if (!cookie || !phone) return;

  ctx.storage.set(KEY + '.keepAliveLastRun', String(now));

  try {
    await loadData(ctx, true);
  } catch (e) {}
}

/* =========================================================
 * 清透磨砂玻璃 UI 组件（1:1 复刻中国广电测试版）
 * ========================================================= */

function fontSize(size) {
  if (typeof size === 'number') {
    if (size <= 8) return 9;
    if (size <= 10) return 10;
    if (size <= 13) return 12;
    if (size <= 19) return 16;
    return 24;
  }

  const named = {
    caption2: 9,
    caption1: 10,
    footnote: 12,
    body: 16,
    title3: 20,
    title2: 22,
    title: 24,
  };
  return named[size] || 12;
}

function t(text, size, weight, color, extra) {
  return Object.assign({
    type: 'text',
    text: String(text),
    font: { size: fontSize(size), weight: weight || 'regular' },
    textColor: color || C.txt,
    maxLines: 1,
    minScale: 0.6,
  }, extra || {});
}

function glass(children, extra) {
  return Object.assign({
    type: 'stack',
    direction: 'column',
    gap: 6,
    padding: [8, 10],
    borderRadius: 16,
    backgroundColor: { light: '#00000000', dark: '#00000000' },
    borderWidth: 0,
    borderColor: { light: '#00000000', dark: '#00000000' },
    shadowRadius: 0,
    children,
  }, extra || {}, {
    backgroundColor: { light: '#00000000', dark: '#00000000' },
    borderWidth: 0,
    borderColor: { light: '#00000000', dark: '#00000000' },
    shadowRadius: 0,
  });
}

function gaugeSvg(pct, color, w) {
  const stroke = 11;
  const r = (w - stroke) / 2;
  const cx = w / 2;
  const cy = w / 2;
  const h = w / 2 + stroke / 2;
  const p = Math.max(0, Math.min(1, Number(pct) || 0));

  const pt = a => [
    (cx - r * Math.cos(a)).toFixed(2),
    (cy - r * Math.sin(a)).toFixed(2),
  ];

  const [x0, y0] = pt(0);
  const [x1, y1] = pt(Math.PI);
  const [xp, yp] = pt(Math.PI * p);

  let body =
    `<path d='M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}' fill='none' stroke='${color}' stroke-opacity='0.18' stroke-width='${stroke}' stroke-linecap='round'/>`;

  if (p > 0.005) {
    body +=
      `<path d='M ${x0} ${y0} A ${r} ${r} 0 0 1 ${xp} ${yp}' fill='none' stroke='${color}' stroke-width='${stroke}' stroke-linecap='round'/>`;
  }

  return 'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>${body}</svg>`
    );
}

function historyDeltaText(history) {
  const vals = (history || []).map(x => Number(x.flowKB)).filter(Number.isFinite);
  if (vals.length < 2) return '采集中';
  const delta = vals[vals.length - 1] - vals[vals.length - 2];
  if (Math.abs(delta) < 1) return '余量基本稳定';
  const f = formatFlow(Math.abs(delta));
  return (delta < 0 ? '较上次减少 ' : '较上次增加 ') + f.number + ' ' + f.unit;
}

function flowStatus(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) {
    return { color: C.flow, label: '套餐用量' };
  }
  const p = Number(pct);
  if (p >= 0.9) return { color: '#C4475B', label: '用量偏高' };
  if (p >= 0.7) return { color: C.fee, label: '注意余量' };
  return { color: C.voice, label: '用量正常' };
}

function trendStrip(ds) {
  const today = todayFlowUsage(ds.history);
  const used = today.value == null ? null : formatFlow(today.value);
  return glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 6,
      children: [
        {
          type: 'image',
          src: historySvg(today.history, C.flow, 100, 30),
          width: 72,
          height: 22,
        },
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'start',
          gap: 1,
          flex: 1,
          children: [
            t('今日流量使用', 9, 'semibold', C.txt),
            t(today.label, 8, 'medium', C.sub, { minScale: 0.65 }),
          ],
        },
        t(used ? used.number + ' ' + used.unit : '采集中', 9, 'bold', C.flow, { minScale: 0.7 }),
      ],
    },
  ], {
    height: 42,
    padding: [5, 8],
    borderRadius: 13,
    gap: 0,
    backgroundColor: transparentMode ? { light: '#00000000', dark: '#00000000' } : { light: '#F8FAFCD9', dark: '#172638D9' },
    borderColor: transparentMode ? { light: '#00000000', dark: '#00000000' } : { light: '#FFFFFFF2', dark: '#D7E7F0B0' },
  });
}

function historySvg(history, color, w, h) {
  const vals = (history || []).map(x => Number(x.flowKB)).filter(Number.isFinite).slice(-12);
  const baseline = h - 2;
  const empty = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><path d='M 2 ${baseline} H ${w - 2}' stroke='${color}' stroke-opacity='.22' stroke-width='1.5' stroke-linecap='round' stroke-dasharray='3 4'/></svg>`;
  if (!vals.length) return 'data:image/svg+xml,' + encodeURIComponent(empty);

  const max = Math.max(1, ...vals);
  const padX = Math.min(3, w * 0.025);
  const gap = Math.max(2, Math.min(5, w * 0.035));
  const count = vals.length;
  const barW = Math.max(2, (w - padX * 2 - gap * (count - 1)) / count);
  const usableH = h - 5;
  const bars = vals.map((v, i) => {
    const bh = Math.max(2, (Math.max(0, v) / max) * usableH);
    const x = padX + i * (barW + gap);
    const y = baseline - bh;
    const opacity = i === count - 1 ? 1 : 0.48 + 0.42 * ((i + 1) / count);
    return `<rect x='${x.toFixed(1)}' y='${y.toFixed(1)}' width='${barW.toFixed(1)}' height='${bh.toFixed(1)}' rx='${Math.min(2, barW / 2).toFixed(1)}' fill='${color}' fill-opacity='${opacity.toFixed(2)}'/>`;
  }).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'><path d='M 1 ${baseline} H ${w - 1}' stroke='${color}' stroke-opacity='.12' stroke-width='1'/>${bars}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/* 专属 / 通用 / 其它 流量三分类展示条（doufu 改版新增） */
function flowBreakdownStrip(ds) {
  const bd = ds && ds.flowBreakdown;
  if (!bd) return null;
  const cats = [
    { key: 'directional', label: '专属流量', color: C.violet },
    { key: 'general', label: '通用流量', color: C.flow },
    { key: 'other', label: '其它流量', color: C.green },
  ];
  const cols = cats.map(c => {
    const v = bd[c.key] || {};
    const f = formatFlow(v.remain);
    return glass([
      t(c.label, 8, 'medium', C.sub),
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'end',
        gap: 2,
        children: [
          t(f.number, 15, 'bold', C.txt, { minScale: 0.5 }),
          t(f.unit, 8, 'semibold', C.sub),
        ],
      },
    ], { width: 0, flex: 1, padding: [6, 8], gap: 2, borderRadius: 14 });
  });
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: cols,
  };
}

function heroFlowCard(ds, cardHeight, cardFlex, isMedium) {
  const remain = ds.flow.number + ' ' + ds.flow.unit;
  const total = ds.plan && ds.plan.total != null ? formatFlow(ds.plan.total) : null;
  const used = ds.plan && ds.plan.used != null ? formatFlow(ds.plan.used) : null;
  const compactFlowDetail = !cardHeight
    ? '总量 ' + (total ? total.number + ' ' + total.unit : '--') + ' · 已用 ' + (used ? used.number + ' ' + used.unit : '--')
    : '';
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const flowStyle = flowStatus(p);
  const flowContent = isMedium
    ? {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 2,
            flex: 1,
            children: [
              t(remain, cardHeight ? 22 : 19, 'bold', C.txt, { minScale: 0.55 }),
              t(compactFlowDetail || '当前剩余', 8, 'medium', C.sub, { minScale: 0.45 }),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            gap: 0,
            children: [
              {
                type: 'image',
                src: gaugeSvg(p != null ? p : 0, flowStyle.color, 68),
                width: 44,
                height: 24,
              },
              t(p != null ? Math.round(p * 100) + '% 已用' : '—', 8, 'bold', flowStyle.color),
            ],
          },
        ],
      }
    : {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 12,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            gap: -2,
            children: [
              {
                type: 'image',
                src: gaugeSvg(p != null ? p : 0, flowStyle.color, 86),
                width: 64,
                height: 34,
              },
              t(p != null ? Math.round(p * 100) + '% 已用' : '—', 10, 'bold', flowStyle.color),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 1,
            flex: 1,
            children: [
              t(remain, cardHeight ? 23 : 20, 'bold', C.txt, { minScale: 0.55 }),
              t('当前剩余', 9, 'medium', C.sub),
              ...(!cardHeight ? [t(compactFlowDetail, 8, 'medium', C.sub, { minScale: 0.45 })] : []),
            ],
          },
        ],
      };
  return glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 6,
      children: [
        {
          type: 'image',
          src: 'sf-symbol:chart.pie.fill',
          width: 13,
          height: 13,
          color: C.flow,
        },
        t('流量主卡', 10, 'semibold', C.txt),
        { type: 'spacer' },
        t(p != null ? Math.round((1 - p) * 100) + '% 剩余' : '实时套餐', 9, 'semibold', flowStyle.color),
      ],
    },
    flowContent,
  ], {
    width: 0,
    flex: cardFlex || 1,
    ...(cardHeight ? { height: cardHeight, maxWidth: 360 } : {}),
    padding: [8, 10],
    borderRadius: 18,
    gap: 4,
    backgroundColor: transparentMode ? { light: '#00000000', dark: '#00000000' } : { light: '#F8FAFCD9', dark: '#172638D9' },
    borderColor: transparentMode ? { light: '#00000000', dark: '#00000000' } : { light: '#FFFFFFF2', dark: '#D7E7F0B0' },
    shadowColor: { light: '#52677A18', dark: '#00000028' },
    shadowRadius: 0,
    shadowOffset: { x: 0, y: 0 },
  });
}

function header(title, ds, fromCache, mediumInset) {
  const dur = ds.captureDuration ? ' · 凭据保持 ' + ds.captureDuration : '';
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    padding: mediumInset ? [4, 6] : 0,
    gap: 5,
    children: [
      {
        type: 'image',
        src: 'sf-symbol:antenna.radiowaves.left.and.right',
        width: 13,
        height: 13,
        color: C.flow,
      },
      t(title, 'footnote', 'semibold', C.txt),
      { type: 'spacer' },
      t(`${fromCache ? '缓存数据' : '更新'} ${fmtTime(ds.updatedAt)}${dur}`, 9, 'medium', C.sub, {
        minScale: 0.8,
      }),
    ],
  };
}

function buildSmall(title, ds, fromCache) {
  const dur = ds.captureDuration ? ' · ' + ds.captureDuration : '';
  const p = ds.plan && ds.plan.percent != null ? ds.plan.percent : null;
  const flowStyle = flowStatus(p);
  const used = ds.plan && ds.plan.used != null
    ? formatFlow(ds.plan.used).number + ' ' + formatFlow(ds.plan.used).unit
    : '--';
  const total = ds.plan && ds.plan.total != null
    ? formatFlow(ds.plan.total).number + ' ' + formatFlow(ds.plan.total).unit
    : '--';

  return {
    type: 'widget',
    padding: [13, 13],
    gap: 6,
    backgroundColor: '#00000000',
    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 5,
        children: [
          {
            type: 'image',
            src: 'sf-symbol:antenna.radiowaves.left.and.right',
            width: 12,
            height: 12,
            color: C.flow,
          },
          t(title, 12, 'semibold', C.txt),
          { type: 'spacer' },
          t(`${fromCache ? '缓存 · ' : ''}${fmtTime(ds.updatedAt)}${dur}`, 8, 'medium', C.sub, { minScale: 0.55 }),
        ],
      },

      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 4,
        flex: 1,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            gap: 2,
            flex: 1,
            children: [
              t('剩余流量', 9, 'medium', C.sub),
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'end',
                gap: 2,
                children: [
                  t(ds.flow.number, 23, 'bold', C.txt, { minScale: 0.35 }),
                  t(ds.flow.unit, 9, 'semibold', C.sub, { minScale: 0.7 }),
                ],
              },
              {
                type: 'stack',
                direction: 'column',
                alignItems: 'start',
                gap: 2,
                children: [
                  t(
                    ds.plan && ds.plan.used != null
                      ? '已用 ' + used
                      : '已用量待确认',
                    8,
                    'semibold',
                    flowStyle.color,
                    { minScale: 0.65 }
                  ),
                  t(
                    ds.plan && ds.plan.total != null
                      ? '总量 ' + total
                      : (ds.plan && ds.plan.remain != null
                        ? '余量 ' + formatFlow(ds.plan.remain).number + ' ' + formatFlow(ds.plan.remain).unit
                        : '总量待确认'),
                    8,
                    'medium',
                    C.sub,
                    { minScale: 0.45 }
                  ),
                ],
              },
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            gap: -2,
            children: [
              {
                type: 'image',
                src: gaugeSvg(p, flowStyle.color, 78),
                width: 44,
                height: 27,
              },
              t(
                p != null ? Math.round(p * 100) + '% 已用' : '套餐',
                8,
                'bold',
                flowStyle.color
              ),
              t(
                (() => {
                  const today = todayFlowUsage(ds.history);
                  return today.value != null
                    ? '今日 ' + formatFlow(today.value).number + formatFlow(today.value).unit
                    : '今日采集中';
                })(),
                8,
                'medium',
                C.sub,
                { minScale: 0.6 }
              ),
            ],
          },
        ],
      },

      ...(flowBreakdownStrip(ds) ? [flowBreakdownStrip(ds)] : []),
      {
        type: 'stack',
        direction: 'row',
        gap: 5,
        children: [
          glass([
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 3, children: [
              { type: 'image', src: 'sf-symbol:phone.fill', width: 10, height: 10, color: C.voice },
              t('剩余语音', 8, 'medium', C.sub),
            ]},
            { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
              t(ds.voice.number === '--' ? '暂无' : ds.voice.number, 18, 'bold', C.txt, { minScale: 0.4 }),
              t(ds.voice.number === '--' ? '' : '分钟', 8, 'semibold', C.sub),
            ]},
          ], { width: 0, flex: 1, height: 48, padding: [7, 7], gap: 4, borderRadius: 15 }),
          glass([
            { type: 'stack', direction: 'row', alignItems: 'center', gap: 3, children: [
              { type: 'image', src: 'sf-symbol:yensign.circle.fill', width: 10, height: 10, color: C.fee },
              t('剩余话费', 8, 'medium', C.sub),
            ]},
            { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
              t('¥', 10, 'semibold', C.fee),
              t(ds.fee.number, 18, 'bold', C.txt, { minScale: 0.4 }),
            ]},
          ], { width: 0, flex: 1, height: 48, padding: [7, 7], gap: 4, borderRadius: 15 }),
        ],
      },
    ],
  };
}

function buildMedium(title, ds, fromCache) {
  const compactFee = glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 4,
      children: [
        {
          type: 'image',
          src: 'sf-symbol:yensign.circle.fill',
          width: 10,
          height: 10,
          color: C.fee,
        },
        t('话费', 9, 'medium', C.sub),
        { type: 'spacer' },
        t('¥' + ds.fee.number, 15, 'bold', C.txt, { minScale: 0.6 }),
      ],
    },
  ], {
    flex: 1,
    padding: [6, 8],
    gap: 1,
    borderRadius: 14,
    justifyContent: 'center',
  });

  const compactVoice = glass([
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 4,
      children: [
        {
          type: 'image',
          src: 'sf-symbol:phone.fill',
          width: 10,
          height: 10,
          color: C.voice,
        },
        t('语音', 9, 'medium', C.sub),
        { type: 'spacer' },
        t(ds.voice.number, 15, 'bold', C.txt, { minScale: 0.6 }),
        t('分', 8, 'semibold', C.sub),
      ],
    },
  ], {
    flex: 1,
    padding: [6, 8],
    gap: 1,
    borderRadius: 14,
  });

  const row = {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 5,
    children: [
      heroFlowCard(ds, null, null, true),
      {
        type: 'stack',
        direction: 'column',
        alignItems: 'center',
        gap: 5,
        width: 100,
        children: [
          compactFee,
          compactVoice,
        ],
      },
    ],
  };

  return {
    type: 'widget',
    padding: [12, 14],
    gap: 6,
    backgroundColor: { light: '#F4F7FB', dark: '#161B22' },
    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    children: [
      header(title, ds, fromCache, true),
      row,
      ...(flowBreakdownStrip(ds) ? [flowBreakdownStrip(ds)] : []),
      trendStrip(ds),
    ],
  };
}

function todayFlowUsage(history) {
  const now = new Date();
  const todayKey = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
  const today = (history || [])
    .filter(x => {
      const ts = Number(x.ts);
      if (!Number.isFinite(ts)) return false;
      const d = new Date(ts);
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() === todayKey;
    })
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  if (today.length < 2) {
    return { value: null, history: today, label: '今日数据采集中' };
  }

  const first = Number(today[0].flowKB);
  const last = Number(today[today.length - 1].flowKB);
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return { value: null, history: today, label: '今日数据采集中' };
  }

  const value = Math.max(0, first - last);
  return {
    value,
    history: today.map(x => ({
      ts: x.ts,
      flowKB: Math.max(0, first - Number(x.flowKB)),
    })),
    label: value < 1 ? '今日暂无明显消耗' : '按今日已记录余量变化估算',
  };
}

function buildLarge(title, ds, fromCache) {
  const plan = ds.plan || {};
  const total = plan.total != null ? formatFlow(plan.total) : null;
  const usedFlow = plan.used != null ? formatFlow(plan.used) : null;
  const voiceUsed = plan.voiceUsed != null ? formatVoice(plan.voiceUsed) : null;
  const voiceTotal = plan.voiceTotal != null ? formatVoice(plan.voiceTotal) : null;
  const p = plan.percent != null ? Math.max(0, Math.min(1, Number(plan.percent))) : null;
  const flowStyle = flowStatus(p);
  const today = todayFlowUsage(ds.history);
  const todayUsed = today.value == null ? null : formatFlow(today.value);

  return {
    type: 'widget',
    padding: [16, 17],
    gap: 9,
    backgroundColor: '#00000000',
    refreshAfter: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    children: [
      header(title, ds, fromCache),
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 12,
        height: 112,
        children: [
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'start',
            justifyContent: 'center',
            gap: 7,
            flex: 1.25,
            children: [
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'center',
                gap: 5,
                children: [
                  { type: 'image', src: 'sf-symbol:chart.pie.fill', width: 13, height: 13, color: C.flow },
                  t('剩余流量', 10, 'semibold', C.sub),
                  { type: 'spacer' },
                  t(p != null ? Math.round((1 - p) * 100) + '% 剩余' : '套餐流量', 9, 'semibold', flowStyle.color),
                ],
              },
              {
                type: 'stack',
                direction: 'row',
                alignItems: 'end',
                gap: 3,
                children: [
                  t(ds.flow.number, 29, 'bold', C.txt, { minScale: 0.45 }),
                  t(ds.flow.unit, 11, 'semibold', C.sub),
                ],
              },
              {
                type: 'stack',
                direction: 'row',
                gap: 4,
                height: 5,
                children: [
                  {
                    type: 'stack',
                    flex: p == null ? 1 : Math.max(0.03, p),
                    backgroundColor: flowStyle.color,
                    borderRadius: 4,
                    children: [],
                  },
                  {
                    type: 'stack',
                    flex: p == null ? 0.001 : Math.max(0.03, 1 - p),
                    backgroundColor: { light: '#7890A52B', dark: '#FFFFFF2B' },
                    borderRadius: 4,
                    children: [],
                  },
                ],
              },
              t('总量 ' + (total ? total.number + ' ' + total.unit : '--') +
                '  ·  已用 ' + (usedFlow ? usedFlow.number + ' ' + usedFlow.unit : '--'), 9, 'medium', C.sub, { minScale: 0.55 }),
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0,
            width: 90,
            children: [
              { type: 'image', src: gaugeSvg(p, flowStyle.color, 110), width: 76, height: 40 },
              t(p != null ? Math.round(p * 100) + '% 已用' : '用量统计', 9, 'bold', flowStyle.color),
            ],
          },
        ],
      },
      ...(flowBreakdownStrip(ds) ? [flowBreakdownStrip(ds)] : []),
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 10,
        padding: [8, 0],
        children: [
          {
            type: 'stack',
            direction: 'column',
            gap: 4,
            flex: 1,
            children: [
              { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
                { type: 'image', src: 'sf-symbol:yensign.circle.fill', width: 12, height: 12, color: C.fee },
                t('剩余话费', 10, 'medium', C.sub),
              ]},
              { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
                t('¥' + ds.fee.number, 21, 'bold', C.txt, { minScale: 0.5 }),
                t('元', 9, 'medium', C.sub),
              ]},
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            gap: 4,
            flex: 1,
            children: [
              { type: 'stack', direction: 'row', alignItems: 'center', gap: 4, children: [
                { type: 'image', src: 'sf-symbol:phone.fill', width: 12, height: 12, color: C.voice },
                t('剩余语音', 10, 'medium', C.sub),
              ]},
              { type: 'stack', direction: 'row', alignItems: 'end', gap: 2, children: [
                t(ds.voice.number === '--' ? '暂无' : ds.voice.number, 21, 'bold', C.txt, { minScale: 0.5 }),
                t(ds.voice.number === '--' ? '' : '分钟', 9, 'medium', C.sub),
              ]},
              t(voiceUsed != null && voiceTotal != null
                ? '已用 ' + voiceUsed + ' / ' + voiceTotal + ' 分钟'
                : '套餐分钟明细暂不可用', 8, 'medium', C.sub, { minScale: 0.55 }),
            ],
          },
        ],
      },
      {
        type: 'stack',
        direction: 'column',
        gap: 5,
        padding: [7, 0, 0, 0],
        children: [
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: 4,
            children: [
              { type: 'image', src: 'sf-symbol:chart.bar.fill', width: 10, height: 10, color: C.flow },
              t('今日流量使用', 10, 'semibold', C.txt),
              { type: 'spacer' },
              t(todayUsed ? todayUsed.number + ' ' + todayUsed.unit : '采集中', 10, 'bold', C.flow),
            ],
          },
          {
            type: 'image',
            src: historySvg(today.history.map(x => ({ flowKB: x.flowKB })), C.flow, 270, 38),
            width: 270,
            height: 38,
          },
          t(today.label, 8, 'medium', C.sub),
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: 4,
            children: [
              { type: 'image', src: 'sf-symbol:clock', width: 9, height: 9, color: C.sub },
              t((fromCache ? '缓存数据 · ' : '最近更新 · ') + fmtTime(ds.updatedAt), 8, 'medium', C.sub),
              { type: 'spacer' },
              t(ds.captureDuration ? '凭据已保持 ' + ds.captureDuration : (fromCache ? '数据可能过期' : '定时保活中'), 8, 'medium', C.sub),
            ],
          },
        ],
      },
    ],
  };
}

function buildLock(title, ds, family) {
  const dur = ds.captureDuration ? ' · 保持' + ds.captureDuration : '';
  if (family === 'accessoryInline') {
    return {
      type: 'widget',
      children: [
        {
          type: 'text',
          text: `¥${ds.fee.number} · ${ds.flow.number}${ds.flow.unit} · ${ds.voice.number}分${dur}`,
          maxLines: 1,
          minScale: 0.6,
        },
      ],
    };
  }

  if (family === 'accessoryCircular') {
    return {
      type: 'widget',
      padding: 7,
      children: [
        { type: 'spacer' },
        {
          type: 'stack',
          direction: 'column',
          alignItems: 'center',
          gap: 0,
          children: [
            {
              type: 'image',
              src: 'sf-symbol:wifi',
              width: 11,
              height: 11,
              color: C.flow,
            },
            t(ds.flow.number, 14, 'bold', C.txt, { minScale: 0.5 }),
            t(ds.flow.unit, 8, 'regular', C.sub),
          ],
        },
        { type: 'spacer' },
      ],
    };
  }

  return {
    type: 'widget',
    padding: [3, 5],
    gap: 2,
    children: [
      t(`话费 ¥${ds.fee.number}`, 'footnote', 'bold', C.fee),
      t(`流量 ${ds.flow.number}${ds.flow.unit} · 语音 ${ds.voice.number}分${dur}`, 'caption2', 'semibold', C.txt, {
        minScale: 0.6,
      }),
    ],
  };
}

function liquidGlassWidget(widget) {
  if (!widget || widget.type !== 'widget') return widget;
  widget.backgroundColor = transparentMode
    ? '#00000000'
    : { light: '#F4F7FB', dark: '#161B22' };
  delete widget.glassContentPadding;
  return widget;
}

function buildError(title, message) {
  return {
    type: 'widget',
    padding: 14,
    gap: 6,
    backgroundColor: transparentMode ? '#00000000' : { light: '#F4F7FB', dark: '#161B22' },
    children: [
      t(title, 'footnote', 'semibold'),
      { type: 'spacer' },
      {
        type: 'image',
        src: 'sf-symbol:exclamationmark.triangle.fill',
        width: 22,
        height: 22,
        color: C.fee,
      },
      t(message, 'caption1', 'medium', C.txt, {
        maxLines: 4,
        minScale: 0.7,
      }),
      { type: 'spacer' },
    ],
  };
}

async function handleWidget(ctx) {
  const title = '中国联通';
  const result = await loadData(ctx);

  if (!result.configured) {
    return buildError(
      title,
      '请打开中国联通 App 查询一次，等待自动捕获数据'
    );
  }

  if (!result.data) {
    return buildError(
      title,
      '查询失败，请重新打开中国联通 App 查询一次'
    );
  }

  const family = ctx.widgetFamily || 'systemSmall';

  if (family === 'systemMedium') {
    return liquidGlassWidget(buildMedium(title, result.data, result.fromCache));
  }

  if (family === 'systemLarge' || family === 'systemExtraLarge') {
    return liquidGlassWidget(buildLarge(title, result.data, result.fromCache));
  }

  if (family.startsWith('accessory')) {
    return buildLock(title, result.data, family);
  }

  return liquidGlassWidget(buildSmall(title, result.data, result.fromCache));
}

export default async function(ctx) {
  // 1. HTTP 抓包模式：自动捕获 Cookie 与手机号
  if (ctx && ctx.request && ctx.request.url) {
    await handleCapture(ctx);
    return;
  }

  // 2. 定时保活模式：支持 schedule (ctx.cron) 或环境变量开启
  if (ctx && (ctx.cron || (ctx.env && ctx.env.CU_KEEPALIVE === 'true'))) {
    return handleKeepAlive(ctx);
  }

  // 3. Generic Widget 模式：渲染小组件 UI
  try {
    const widget = await handleWidget(ctx || {});
    if (widget && widget.type === 'widget') return widget;
    return buildError('中国联通', '组件返回内容异常，请刷新模块');
  } catch (e) {
    return buildError('中国联通', '组件渲染异常：' + String(e && e.message ? e.message : e).slice(0, 80));
  }
}
