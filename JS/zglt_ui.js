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

function headerRow(title, ds) {
  const updateTime = fmtTime(ds && ds.updatedAt);
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
          { type: 'text', text: title, font: { size: 'headline', weight: 'semibold' }, textColor: COLORS.value, maxLines: 1, minScale: 0.8 },
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
          { type: 'text', text: updateTime, font: { size: 'caption2' }, textColor: COLORS.time, maxLines: 1 },
        ],
      },
    ],
  };
}

function makeCapsule(title, value, unit) {
  return {
    type: 'stack',
    direction: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: [7, 8, 7, 8],
    backgroundColor: COLORS.capsuleBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    children: [
      { type: 'text', text: title, font: { size: 'caption2', weight: 'medium' }, textColor: COLORS.title, textAlign: 'center', maxLines: 1, minScale: 0.7 },
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        children: [
          { type: 'text', text: String(value), font: { size: 'title2', weight: 'semibold' }, textColor: COLORS.value, textAlign: 'center', maxLines: 1, minScale: 0.55 },
          { type: 'text', text: unit, font: { size: 'caption2' }, textColor: COLORS.title, maxLines: 1, minScale: 0.7 },
        ],
      },
    ],
  };
}

/* 专属 / 通用 / 其它 三分类胶囊行（无明细数据时返回 null） */
function breakdownRow(ds) {
  const bd = ds && ds.flowBreakdown;
  if (!bd) return null;
  const defs = [
    ['专属流量', 'directional'],
    ['通用流量', 'general'],
    ['其它流量', 'other'],
  ];
  const cols = defs.map(([label, key]) => {
    const f = formatFlow(bd[key] ? bd[key].remain : null);
    return makeCapsule(label, f.number, f.unit);
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

function buildMainWidget(title, ds) {
  const bdRow = breakdownRow(ds);
  const children = [
    headerRow(title, ds),
    {
      type: 'stack',
      direction: 'row',
      alignItems: 'center',
      gap: 8,
      children: [
        makeCapsule('剩余话费', ds.fee.number, ds.fee.unit),
        makeCapsule('剩余语音', ds.voice.number, '分钟'),
        makeCapsule('剩余流量', ds.flow.number, ds.flow.unit),
      ],
    },
  ];
  if (bdRow) children.push(bdRow);
  children.push(bottomDash());
  return {
    type: 'widget',
    padding: [10, 14, 10, 14],
    gap: 10,
    backgroundColor: COLORS.bg,
    refreshAfter: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    children,
  };
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

function buildSmall(title, ds) {
  return {
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
  const family = ctx.widgetFamily || 'systemSmall';
  if (family === 'systemMedium' || family === 'systemLarge' || family === 'systemExtraLarge') {
    return buildMainWidget(title, result.data);
  }
  if (family.startsWith('accessory')) {
    return buildLockScreen(title, result.data, family);
  }
  return buildSmall(title, result.data);
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
