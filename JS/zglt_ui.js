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
