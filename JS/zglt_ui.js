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
 * 简洁白卡 UI（面板样式参考 iBL3ND Unicom_Widget，数据抓取与专属/通用/其它三分类逻辑为 doufu 改版）
 * ========================================================= */

const COLORS = {
  bg: { light: '#FFFFFF', dark: '#2C2C2E' },
  border: { light: '#E5E5EA', dark: '#3A3A3C' },
  title: { light: '#666666', dark: '#8E8E93' },
  value: { light: '#1C1C1E', dark: '#FFFFFF' },
  time: { light: '#999999', dark: '#666666' },
  error: { light: '#FF3B30', dark: '#FF453A' },
  capsuleBg: { light: '#FFFFFF15', dark: '#FFFFFF10' },
  accent: { light: '#E60012', dark: '#FF375F' },
};

/* 小组件背景图（data URI 内嵌，1200x675 JPEG；模块参数 cuBgImage 可开关） */
const BG_IMAGE = 'data:image/jpeg;base64,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';

function headerRow(title, ds, useBg) {
  const updateTime = fmtTime(ds && ds.updatedAt);
  const ink = useBg ? '#1C1C1E' : COLORS.value;
  const subInk = useBg ? '#666666' : COLORS.time;
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          { type: 'image', src: 'sf-symbol:simcard.fill', color: COLORS.accent, width: 17, height: 17 },
          { type: 'text', text: title, font: { size: 'headline', weight: 'semibold' }, textColor: ink, maxLines: 1, minScale: 0.8 },
        ],
      },
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 5,
        children: [
          { type: 'image', src: 'sf-symbol:arrow.clockwise', color: COLORS.time, width: 12, height: 12 },
          { type: 'text', text: updateTime, font: { size: 'caption2' }, textColor: subInk, maxLines: 1 },
        ],
      },
    ],
  };
}

function makeCapsule(title, value, unit, useBg) {
  return {
    type: 'stack',
    direction: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: [7, 8, 7, 8],
    backgroundColor: useBg ? '#FFFFFFF2' : COLORS.capsuleBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: useBg ? '#E5E5EA' : COLORS.border,
    children: [
      { type: 'text', text: title, font: { size: 'caption2', weight: 'medium' }, textColor: useBg ? '#666666' : COLORS.title, textAlign: 'center', maxLines: 1, minScale: 0.7 },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        children: [
          { type: 'text', text: String(value), font: { size: 'title2', weight: 'semibold' }, textColor: useBg ? '#1C1C1E' : COLORS.value, textAlign: 'center', maxLines: 1, minScale: 0.55 },
          { type: 'text', text: unit, font: { size: 'caption2' }, textColor: useBg ? '#666666' : COLORS.title, maxLines: 1, minScale: 0.7 },
        ],
      },
    ],
  };
}

/* 专属 / 通用 / 其它 三分类胶囊行（无明细数据时返回 null） */
function breakdownRow(ds, useBg) {
  const bd = ds && ds.flowBreakdown;
  if (!bd) return null;
  const defs = [
    ['专属流量', 'directional'],
    ['通用流量', 'general'],
    ['其它流量', 'other'],
  ];
  const cols = defs.map(([label, key]) => {
    const f = formatFlow(bd[key] ? bd[key].remain : null);
    return makeCapsule(label, f.number, f.unit, useBg);
  });
  return { type: 'stack', direction: 'row', alignItems: 'center', gap: 8, children: cols };
}

function bottomDash() {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    children: [
      { type: 'spacer' },
      { type: 'stack', width: 42, height: 3, borderRadius: 2, backgroundColor: COLORS.border },
      { type: 'spacer' },
    ],
  };
}

function buildMainWidget(title, ds, useBg) {
  const bdRow = breakdownRow(ds, useBg);
  const children = [
    headerRow(title, ds, useBg),
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 8,
      children: [
        makeCapsule('剩余话费', ds.fee.number, ds.fee.unit, useBg),
        makeCapsule('剩余语音', ds.voice.number, '分钟', useBg),
        makeCapsule('剩余流量', ds.flow.number, ds.flow.unit, useBg),
      ],
    },
  ];
  if (bdRow) children.push(bdRow);
  children.push(bottomDash());
  const w = {
    type: 'widget',
    padding: [10, 14, 10, 14],
    gap: 10,
    backgroundColor: COLORS.bg,
    refreshAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    children,
  };
  if (useBg) w.backgroundImage = BG_IMAGE;
  return w;
}

/* 小尺寸：三行横条（话费 / 流量 / 语音） */
function smallRow(color, symbol, glyph, value, unit, label) {
  const iconChild = symbol
    ? { type: 'image', src: symbol, color: '#FFFFFF', width: 16, height: 16 }
    : { type: 'text', text: glyph, font: { size: 'headline', weight: 'bold' }, textColor: '#FFFFFF' };
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    padding: [4, 8, 4, 8],
    backgroundColor: { light: color + '40', dark: color + '33' },
    borderRadius: 14,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: { light: color, dark: color + '60' },
        children: [iconChild],
      },
      {
        type: 'stack',
        direction: 'column',
        flex: 1,
        children: [
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            gap: 3,
            children: [
              { type: 'text', text: String(value), font: { size: 'title3', weight: 'bold' }, textColor: color, maxLines: 1, minScale: 0.5 },
              { type: 'text', text: String(unit), font: { size: 'caption1', weight: 'semibold' }, textColor: color, maxLines: 1 },
              { type: 'spacer' },
            ],
          },
          {
            type: 'stack',
            direction: 'row',
            alignItems: 'center',
            children: [
              { type: 'text', text: String(label), font: { size: 'caption2', weight: 'medium' }, textColor: color + 'B3', maxLines: 1, minScale: 0.7 },
              { type: 'spacer' },
            ],
          },
        ],
      },
    ],
  };
}

function buildSmall(title, ds, useBg) {
  const w = {
    type: 'widget',
    padding: [10, 10, 10, 10],
    gap: 6,
    backgroundColor: COLORS.bg,
    refreshAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    children: [
      smallRow('#E8651F', null, '¥', ds.fee.number, ds.fee.unit, '剩余话费'),
      smallRow('#4DA6F0', 'sf-symbol:antenna.radiowaves.left.and.right', '', ds.flow.number, ds.flow.unit, '剩余流量'),
      smallRow('#55C759', 'sf-symbol:phone.and.waveform.fill', '', ds.voice.number, '分钟', '剩余语音'),
    ],
  };
  if (useBg) w.backgroundImage = BG_IMAGE;
  return w;
}

function buildLockScreen(title, ds, family) {
  const SUB = { light: '#FFFFFFB3', dark: '#FFFFFFB3' };
  if (family === 'accessoryInline') {
    return {
      type: 'widget',
      children: [
        {
          type: 'text',
          text: `${title} ${ds.fee.number}${ds.fee.unit} · ${ds.flow.number}${ds.flow.unit}`,
          font: { size: 'caption1', weight: 'medium' },
          maxLines: 1,
          minScale: 0.5,
        },
      ],
    };
  }
  if (family === 'accessoryCircular') {
    return {
      type: 'widget',
      padding: 2,
      children: [
        { type: 'spacer' },
        { type: 'text', text: `${ds.flow.number}`, font: { size: 'headline', weight: 'bold' }, textAlign: 'center', maxLines: 1, minScale: 0.5 },
        { type: 'text', text: ds.flow.unit, font: { size: 'caption2' }, textColor: SUB, textAlign: 'center', maxLines: 1 },
        { type: 'spacer' },
      ],
    };
  }
  const line = (label, value, unit) => ({
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 4,
    children: [
      { type: 'text', text: label, font: { size: 'caption2', weight: 'medium' }, textColor: SUB, maxLines: 1 },
      { type: 'spacer' },
      { type: 'text', text: String(value), font: { size: 'caption1', weight: 'bold' }, maxLines: 1, minScale: 0.6 },
      { type: 'text', text: String(unit), font: { size: 'caption2' }, textColor: SUB, maxLines: 1 },
    ],
  });
  return {
    type: 'widget',
    padding: 2,
    gap: 2,
    children: [
      line('话费', ds.fee.number, ds.fee.unit),
      line('流量', ds.flow.number, ds.flow.unit),
      line('语音', ds.voice.number, '分钟'),
    ],
  };
}

function buildError(title, message) {
  return {
    type: 'widget',
    padding: 12,
    backgroundColor: COLORS.bg,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          { type: 'image', src: 'sf-symbol:exclamationmark.triangle.fill', color: COLORS.error, width: 15, height: 15 },
          { type: 'text', text: title, font: { size: 'headline', weight: 'semibold' }, textColor: COLORS.value, maxLines: 1 },
        ],
      },
      { type: 'spacer' },
      { type: 'text', text: message, font: { size: 'caption1', weight: 'medium' }, textColor: COLORS.title, textAlign: 'center', maxLines: 3, minScale: 0.75 },
      { type: 'spacer' },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        children: [
          { type: 'spacer' },
          {
            type: 'stack',
            padding: [5, 12, 5, 12],
            backgroundColor: COLORS.capsuleBg,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: COLORS.border,
            children: [
              { type: 'text', text: '打开联通 App 查询一次', font: { size: 'caption2', weight: 'medium' }, textColor: COLORS.accent, maxLines: 1 },
            ],
          },
          { type: 'spacer' },
        ],
      },
    ],
  };
}

async function handleWidget(ctx) {
  const title = '中国联通';
  const result = await loadData(ctx);
  if (!result.configured) {
    return buildError(title, '请打开联通 App，进入首页并点击余额位置');
  }
  if (!result.data) {
    return buildError(title, '数据获取失败，请重新打开联通 App 查询一次');
  }
  const useBg = !ctx.env || ctx.env.CU_BG_IMAGE !== 'false';
  const family = ctx.widgetFamily || 'systemSmall';
  if (family === 'systemMedium' || family === 'systemLarge' || family === 'systemExtraLarge') {
    return buildMainWidget(title, result.data, useBg);
  }
  if (family.startsWith('accessory')) {
    return buildLockScreen(title, result.data, family);
  }
  return buildSmall(title, result.data, useBg);
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
