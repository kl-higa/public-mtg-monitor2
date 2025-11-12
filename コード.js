/**
 * METI Meeting Monitor & Summarizer (β版)
 * 
 * 【機能概要】
 * - 経産省検討会ページの新着検知 → PDF OCR/YouTube字幕取得 → Gemini要約 → メール送信
 * - 8会議を自動監視、要約をメール配信
 * - ユーザー管理（購読/配信停止）、Archive（会議履歴）機能搭載
 * 
 * 【必要な設定】
 * - Script Properties: GEMINI_API_KEY / VPS_FETCH_BASE / VPS_FETCH_TOKEN / MAIL_FROM / MAIL_FROM_NAME
 * - 高度なサービス: Drive API を有効化（PDF OCR用）
 * 
 * 【更新履歴】
 * - 2025/11/11: β版完成、テスト関数整理、Bot判定回避、文字数制限強化
 */

/* ========================================================================== */
/* 1. CONFIG（設定）                                                          */
/* ========================================================================== */

const CONFIG = {
  DEFAULT_RECIPIENTS: ['toshihiro.higaki@klammer.co.jp'],
  SEND_MODE: 'each',  // 'each' = 個別送信 / 'bulk' = 一括送信
  STORE_KEY: 'multi_meeting_state_v2',

  // Gemini API
  GEMINI: {
    ENABLE: true,
    MODEL: 'gemini-2.5-flash',
    API_KEY_PROP: 'GEMINI_API_KEY',
    MAX_CHARS_PER_CHUNK: 50000
  },

  // YouTube字幕
  YOUTUBE: { 
    PREFERRED_LANGS: ['ja', 'ja-JP'], 
    FALLBACK_ALLOW_AUTO: true 
  },

  // 要約品質
  SUMMARY: {
    ALLOW_FALLBACK: false,
    MIN_CHARS: 500,
    MAX_DUP_RATIO: 0.45,
    BUDGET: {
      MODE: 'digest',
      TOTAL_CHARS: 4000,
      SUMMARY_LINES: 2,
      COMMENT_LINES: 3,
      COMMENT_LINE_MAX: 60
    }
  },

  // Webアプリ
  APP: {
    BASE_WEBAPP_URL: 'https://script.google.com/macros/s/AKfycbwrxqvhRqmk7M18e21x_4quc3Ll3jzHpZQYnn3QQSp7Q7Io1JcThIEN4uQ8uKoGJHVi1A/exec',
    SECRET: "klammer-meeting-monitor-secret-2025"
  },

  // 監視対象（フォールバック用、通常はシートから読み込み）
  SOURCES: [
    { id: 1, agency: '経済産業省', name: '同時市場の在り方等に関する検討会',
      indexUrl: 'https://www.meti.go.jp/shingikai/energy_environment/doji_shijo_kento/index.html' },
    { id: 2, agency: '経済産業省', name: '電力システム改革の検証を踏まえた制度設計WG',
      indexUrl: 'https://www.meti.go.jp/shingikai/enecho/denryoku_gas/jisedai_kiban/system_design_wg/index.html' },
    { id: 3, agency: '経済産業省', name: '排出量取引制度小委員会',
      indexUrl: 'https://www.meti.go.jp/shingikai/sankoshin/sangyo_gijutsu/emissions_trading/index.html' },
    { id: 4, agency: '経済産業省', name: '製造業ベンチマーク検討WG',
      indexUrl: 'https://www.meti.go.jp/shingikai/sankoshin/sangyo_gijutsu/emissions_trading/benchmark_wg/index.html' },
    { id: 5, agency: '経済産業省', name: '発電ベンチマーク検討WG',
      indexUrl: 'https://www.meti.go.jp/shingikai/sankoshin/sangyo_gijutsu/emissions_trading/power_generation_benchmark/index.html' }
  ]
};

// フラグ
CONFIG.TEST = { FORCE_ASR: false };
CONFIG.DEBUG = false;

// VPS設定
CONFIG.SUBS = {
  BASE_URL: PropertiesService.getScriptProperties().getProperty('VPS_FETCH_BASE'),
  TOKEN: PropertiesService.getScriptProperties().getProperty('VPS_FETCH_TOKEN')
};

// スプレッドシート
CONFIG.RECIPIENTS = {
  SHEET_ID: '1iDePcEnE6SEoj-0PazaFhYhwUH17kM3lz3aTmwaFAk4',
  SHEET_NAME: 'recipients'
};

CONFIG.SOURCES_SHEET = {
  SHEET_ID: CONFIG.RECIPIENTS.SHEET_ID,
  SHEET_NAME: 'sources'
};

CONFIG.ARCHIVE = {
  SHEET_ID: CONFIG.RECIPIENTS.SHEET_ID,
  SHEET_NAME: 'archive'
};

/* ========================================================================== */
/* 2. 本番運用関数（定期実行・監視）                                          */
/* ========================================================================== */

/**
 * シートから監視対象の会議を取得（キャッシュ付き）
 */
function getSources_() {
  const cacheKey = 'sources_cache';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SOURCES_SHEET.SHEET_ID)
      .getSheetByName(CONFIG.SOURCES_SHEET.SHEET_NAME);
    
    if (!sheet) {
      Logger.log('⚠️ sources sheet not found, using CONFIG.SOURCES');
      return CONFIG.SOURCES;
    }
    
    const data = sheet.getDataRange().getValues();
    const sources = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const id = row[0];
      const agency = String(row[1] || '').trim();
      const name = String(row[2] || '').trim();
      const indexUrl = String(row[3] || '').trim();
      const active = row[4];
      const note = String(row[5] || '').trim();
      
      if (!name || !indexUrl) continue;
      if (active === false || active === 'FALSE' || active === 'false' || active === 0 || active === '') continue;
      
      sources.push({ 
        id: id || i,
        agency: agency || '未分類', 
        name, 
        indexUrl,
        note
      });
    }
    
    cache.put(cacheKey, JSON.stringify(sources), 300);  // 5分キャッシュ
    Logger.log(`✅ Loaded ${sources.length} active sources from sheet`);
    return sources;
    
  } catch (e) {
    Logger.log(`⚠️ Error loading sources from sheet: ${e.message}, using CONFIG.SOURCES`);
    return CONFIG.SOURCES;
  }
}

/**
 * 毎日実行される本番処理（トリガー設定必要）
 */
function dailyCheckAll() {
  const state = loadState_();
  const sources = getSources_();
  
  if (!sources.length) {
    Logger.log('⚠️ No active sources found');
    return;
  }
  
  for (const src of sources) {
    const baseDir = toDir_(src.indexUrl);
    const html = fetchText_(src.indexUrl);
    
    if (!html) { 
      Logger.log(`skip (fetch failed): [${src.id}] [${src.agency}] ${src.name}`); 
      continue; 
    }

    state[src.indexUrl] = state[src.indexUrl] || {};
    state[src.indexUrl].lastCheckedAt = new Date().toISOString();

    // 関連会議の自動検知
    const relatedCommittees = detectRelatedCommittees_(src.indexUrl, html, baseDir);
    if (relatedCommittees.length > 0) {
      const unregistered = relatedCommittees.filter(item => !isRelatedCommitteeRegistered_(item.url));
      notifyUnregisteredCommittees_(src.name, unregistered);
    }

    // 会議ページ一覧抽出
    const pages = extractMeetingPages_(html, baseDir);
    if (!pages.length) continue;

    // 初回シード
    if (!state[src.indexUrl].lastId) {
      state[src.indexUrl].lastId = pages[0].id;
      state[src.indexUrl].lastUrl = pages[0].url;
      state[src.indexUrl].pendingSummary = null;
      Logger.log(`first-run seed: [${src.id}] [${src.agency}] ${src.name} -> ${pages[0].id} ${pages[0].url}`);
      saveState_(state);
      continue;
    }

    const lastId = state[src.indexUrl].lastId;
    const newcomers = pages.filter(p => p.id > lastId).sort((a, b) => a.id - b.id);

    // 新着処理
    for (const p of newcomers) {
      const mt = scrapeMeetingPage_(p.url);
      
      if (!isMeetingPageLikelyValid_(mt)) {
        Logger.log('skip: page seems not yet published or invalid -> ' + p.url);
        continue;
      }

      const agendaPdf = mt.pdfs.find(x => x.isAgenda);
      const rosterPdf = mt.pdfs.find(x => x.isRoster);

      // PDF OCR
      let agendaText = '', rosterText = '';
      try { if (agendaPdf) agendaText = extractPdfTextViaVps_(agendaPdf.url); } catch (e) { Logger.log('OCR agenda error: ' + e); }
      try { if (rosterPdf) rosterText = extractPdfTextViaVps_(rosterPdf.url); } catch (e) { Logger.log('OCR roster error: ' + e); }
      
      // 字幕取得（VPS優先）
      let transcript = '';
      let transcriptSource = 'なし';
      if (mt.youtube) {
        const r = fetchSubsViaVps_(mt.youtube);
        transcript = r.text || '';
        transcriptSource = r.source || 'なし';
      }
      
      transcript = cleanTranscript_(transcript);

      // 要約生成
      let finalSummary = '';
      if (transcript && !isReportPage_(mt)) {
        finalSummary = summarizeMeeting_(mt, agendaText, rosterText, transcript) || '';
      }

      const sendSummary = shouldSendSummary_(finalSummary);
      const finalToSend = sendSummary ? finalSummary : '';

      // メール送信
      const sourceTag = transcript ? transcriptSource : (isReportPage_(mt) ? 'レポート' : 'ASR予定');
      const agendaSmart = extractAgendaSmartFromGijishidai_(agendaText || '');
      const agendaBlock = agendaSmart.block || fallbackAgendaFromTitleOrPdfs_(mt) || '';
      
      const { subject, plain, htmlBody } = buildMailWithSummary_(mt, finalToSend, buildLinksBlock_(mt, agendaPdf, rosterPdf), sourceTag, agendaBlock);

      const recObjs = getRecipientsForSource_(src.name);
      
      if (!recObjs.length) {
        Logger.log('no recipients for ' + src.name);
      }

      recObjs.forEach(r => {
        const unsubUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?action=unsubscribe&token=${encodeURIComponent(r.token)}&email=${encodeURIComponent(r.email)}&source=${encodeURIComponent(src.name)}`;
        const resubUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?action=resub&token=${encodeURIComponent(r.token)}&email=${encodeURIComponent(r.email)}&source=${encodeURIComponent(src.name)}`;
        const sourcesListUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?page=sources`;
        
        const footer = `
――――――――――――
配信設定: 停止 ${unsubUrl}
再登録: ${resubUrl}
監視対象会議: ${sourcesListUrl}

© Klammer Inc.`;

        const plainPerUser = plain + footer;
        const htmlPerUser = injectFooterHtml_(htmlBody, unsubUrl, resubUrl);

        if (!shouldSkipDuplicateV2_(mt.pageUrl, r.email)) {
          sendToRecipients_([r.email], subject, plainPerUser, htmlPerUser);
        } else {
          Logger.log('skip duplicate mail (new): ' + mt.pageUrl + ' -> ' + r.email);
        }
      });

      // Archive保存
      saveToArchive_(
        src.id,
        src.name,
        src.agency || '経済産業省',
        p.id,
        {
          date: mt.date,
          title: mt.title,
          url: p.url,
          youtube: mt.youtube,
          agendaPdfUrl: agendaPdf ? agendaPdf.url : '',
          rosterPdfUrl: rosterPdf ? rosterPdf.url : ''
        },
        finalToSend,
        finalToSend.length,
        sourceTag
      );

      // 状態更新
      state[src.indexUrl].lastId = p.id;
      state[src.indexUrl].lastUrl = p.url;
      state[src.indexUrl].lastSent = new Date().toISOString();
      state[src.indexUrl].pendingSummary = null;
      saveState_(state);
    }
  }
  
  Logger.log('✅ dailyCheckAll完了');
}

/**
 * 定期実行トリガーの設定（初回のみ手動実行）
 */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dailyCheckAll') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('dailyCheckAll')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
  Logger.log('✅ Trigger set for dailyCheckAll at 09:00 JST');
}

/* ========================================================================== */
/* 3. データ取得（Webスクレイピング・VPS連携）                               */
/* ========================================================================== */

function fetchText_(url) {
  return fetchViaVps_(url);
}

function fetchViaVps_(url) {
  if (!CONFIG.SUBS.BASE_URL || !CONFIG.SUBS.TOKEN) {
    Logger.log('[fetchViaVps_] VPS設定なし、直接取得へ');
    try {
      return UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText();
    } catch (e) {
      Logger.log('[fetchViaVps_] 直接取得失敗: ' + e);
      return '';
    }
  }

  try {
    // GET リクエスト + クエリパラメータ方式
    const fetcherUrl = CONFIG.SUBS.BASE_URL + '/fetcher/crawl?url=' + encodeURIComponent(url);
    
    const res = UrlFetchApp.fetch(fetcherUrl, {
      muteHttpExceptions: true,
      headers: { 'Authorization': 'Bearer ' + CONFIG.SUBS.TOKEN }
    });
    
    const code = res.getResponseCode();
    
    if (code >= 200 && code < 400) {
      const txt = res.getContentText('UTF-8');
      Logger.log('[fetchViaVps_] Fetcher経由で取得成功: ' + txt.length + ' chars');
      return txt;
    } else {
      Logger.log(`[fetchViaVps_] HTTP ${code}`);
      return '';
    }
  } catch (e) {
    Logger.log('[fetchViaVps_] エラー: ' + e.message);
    return '';
  }
}

function extractMeetingPages_(html, baseDir) {
  const pages = [];
  const pattern = /<a\s+href="([^"]+\/)(\d+)\.html"[^>]*?>(?:.*?第\s*([0-9０-９]+)\s*回|.*?)<\/a>/gi;
  let m;
  
  while ((m = pattern.exec(html)) !== null) {
    const relDir = m[1];
    const fileNum = m[2];
    const rawId = m[3] || fileNum;
    const id = normalizeNum_(rawId);
    const url = absoluteUrl_(baseDir, relDir + fileNum + '.html');
    
    if (id && !pages.some(p => p.id === id)) {
      pages.push({ id, url });
    }
  }
  
  return pages.sort((a, b) => b.id - a.id);
}

function detectRelatedCommittees_(indexUrl, html, baseDir) {
  const relatedCommittees = [];
  const pattern = /<a\s+href="([^"]+\/index\.html)"[^>]*?>(.*?)<\/a>/gi;
  let m;
  
  while ((m = pattern.exec(html)) !== null) {
    const relPath = m[1];
    const linkText = m[2].replace(/<[^>]+>/g, '').trim();
    
    if (relPath.includes('index.html') && !relPath.startsWith('http') && relPath !== './index.html') {
      const fullUrl = absoluteUrl_(baseDir, relPath);
      
      if (fullUrl !== indexUrl && linkText.match(/委員会|ワーキンググループ|WG|検討会/)) {
        relatedCommittees.push({ url: fullUrl, name: linkText });
      }
    }
  }
  
  return relatedCommittees;
}

function isRelatedCommitteeRegistered_(url) {
  const sources = getSources_();
  return sources.some(s => s.indexUrl === url);
}

function notifyUnregisteredCommittees_(sourceName, unregistered) {
  if (!unregistered.length) return;
  
  const message = `${sourceName}に関連する未登録の会議が見つかりました:\n\n` +
    unregistered.map(item => `- ${item.name}\n  ${item.url}`).join('\n\n');
  
  Logger.log(message);
}

function scrapeMeetingPage_(url) {
  const html = fetchText_(url);
  if (!html) return null;

  const mt = {
    title: '',
    date: '',
    format: '',
    roster: '',
    youtube: '',
    pdfs: [],
    pageUrl: url
  };

  const titleMatch = html.match(/<title[^>]*?>(.*?)<\/title>/i);
  if (titleMatch) mt.title = titleMatch[1].replace(/<[^>]+>/g, '').trim();

  const youtubePatterns = [
    /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|live\/)|youtu\.be\/)[\w\-]+/gi,
    /youtube\.com\/(?:watch\?v=|live\/)([\w\-]+)/gi
  ];
  
  for (const pattern of youtubePatterns) {
    const match = html.match(pattern);
    if (match) {
      mt.youtube = match[0];
      break;
    }
  }

  const pdfPattern = /<a\s+href="([^"]+\.pdf)"[^>]*?>(.*?)<\/a>/gi;
  const baseDir = toDir_(url);
  let pdfMatch;
  
  while ((pdfMatch = pdfPattern.exec(html)) !== null) {
    const pdfPath = pdfMatch[1];
    const linkText = pdfMatch[2].replace(/<[^>]+>/g, '').trim();
    const pdfUrl = absoluteUrl_(baseDir, pdfPath);
    
    const isAgenda = /議事次第|次第/.test(linkText);
    const isRoster = /委員名簿|名簿/.test(linkText);
    
    const refMatch = linkText.match(/(?:資料|参考資料|別添|別紙|参考|議事録)[\s　]*(\d+)/);
    let refType = '';
    let refNo = null;
    
    if (linkText.includes('資料') && !linkText.includes('参考資料')) {
      refType = '資料';
      if (refMatch) refNo = parseInt(refMatch[1]);
    } else if (linkText.includes('参考資料')) {
      refType = '参考資料';
      if (refMatch) refNo = parseInt(refMatch[1]);
    }
    
    mt.pdfs.push({ url: pdfUrl, title: linkText, isAgenda, isRoster, refType, refNo });
  }

  return mt;
}

function isMeetingPageLikelyValid_(mt) {
  if (!mt) return false;
  if (mt.youtube || mt.pdfs.length >= 2) return true;
  return false;
}

function buildLinksBlock_(mt, agendaPdf, rosterPdf) {
  let block = '';
  if (agendaPdf) block += `・議事次第：${agendaPdf.url}\n`;
  if (rosterPdf) block += `・委員名簿：${rosterPdf.url}\n`;
  return block.trim();
}

/* ========================================================================== */
/* 4. PDF OCR・YouTube字幕取得                                                */
/* ========================================================================== */

function extractPdfTextViaVps_(pdfUrl) {
  const VPS_URL = 'https://fetch.klammer.co.jp/asr/pdf';
  const TOKEN = PropertiesService.getScriptProperties().getProperty('ASR_TOKEN');
  
  if (!TOKEN) {
    Logger.log('[extractPdfTextViaVps_] ASR_TOKEN not set');
    return '';
  }
  
  const payload = {
    url: pdfUrl,
    lang: 'jpn'
  };
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(VPS_URL, options);
    const code = response.getResponseCode();
    
    if (code !== 200) {
      Logger.log(`[extractPdfTextViaVps_] HTTP ${code}: ${response.getContentText()}`);
      return '';
    }
    
    const json = JSON.parse(response.getContentText());
    const txt = json.text || '';
    Logger.log(`OCR success: ${json.pages || 0} pages, ${txt.length} chars`);
    return txt;
  } catch (e) {
    Logger.log('[extractPdfTextViaVps_] Error: ' + e.message);
    return '';
  }
}

function fetchSubsViaVps_(youtubeUrl) {
  Logger.log('[DEBUG] fetchSubsViaVps_ 開始: ' + youtubeUrl);
  
  const ASR_TOKEN = PropertiesService.getScriptProperties().getProperty('ASR_TOKEN');
  const BASE_URL = CONFIG.SUBS.BASE_URL || 'https://fetch.klammer.co.jp';
  
  if (!ASR_TOKEN) {
    Logger.log('[fetchSubsViaVps_] ASR_TOKEN not set');
    return '';
  }

  try {
    const endpoint = BASE_URL + '/asr/youtube-subs';
    Logger.log('[DEBUG] 字幕エンドポイント: ' + endpoint);
    
    const opts = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + ASR_TOKEN },
      payload: JSON.stringify({ url: youtubeUrl }),
      muteHttpExceptions: true
    };
    
    const res = UrlFetchApp.fetch(endpoint, opts);
    const code = res.getResponseCode();
    Logger.log('[DEBUG] 字幕レスポンスコード: ' + code);
    
    if (code === 200) {
      const data = JSON.parse(res.getContentText() || '{}');
      if (data.transcript) {
        Logger.log('VPS APIから字幕取得成功: ' + data.transcript.length + '文字');
        return data.transcript;
      }
    } else {
      Logger.log('[DEBUG] 字幕レスポンス: ' + res.getContentText().substring(0, 200));
    }
    
    return '';
  } catch (e) {
    Logger.log('[fetchSubsViaVps_] エラー: ' + e.message);
    return '';
  }
}

function cleanTranscript_(txt) {
  if (!txt) return '';
  return txt.replace(/\[音楽\]/g, '').replace(/\s+/g, ' ').trim();
}

/* ========================================================================== */
/* 5. 要約生成（Gemini API）                                                  */
/* ========================================================================== */

function summarizeMeeting_(meeting, agendaText, rosterText, transcriptText) {
  if (!CONFIG.GEMINI.ENABLE) return '';
  
  const key = PropertiesService.getScriptProperties().getProperty(CONFIG.GEMINI.API_KEY_PROP);
  if (!key) return '';

  // チャンク分割
  const chunkMax = CONFIG.GEMINI.MAX_CHARS_PER_CHUNK || 50000;
  const chunks = chunkText_(transcriptText, chunkMax);
  Logger.log(`[sum] transcript_len=${transcriptText.length}, chunks=${chunks.length}, chunkMax=${chunkMax}`);

  // 部分要約
  const partials = chunks.map((t, i) => {
    const promptA = [
      'あなたは「日本の行政会議の要約編集者」。以下の文字起こしチャンクを日本語で箇条書き要約する。',
      '誇張や推測禁止。重要発言・数値・制度名・論点・賛否・事務局対応に集中。',
      '文末は常体（〜である）。冗長な言い換えは削る。重複は避ける。',
      `# チャンク ${i + 1}/${chunks.length}\n${t}`
    ].join('\n');
    
    const out = callGemini_(key, CONFIG.GEMINI.MODEL, promptA) || '';
    Logger.log(`[sum] partial ${i + 1}/${chunks.length} len=${out.length}`);
    return out;
  });
  
  const merged = partials.filter(Boolean).join('\n');
  if (!merged) return '';

  // 議題ブロック抽出
  const agendaStrict = extractAgendaStrictFromGijishidai_(agendaText || '');
  const agendaFromText = extractAgendaFromText_(agendaText || '');
  const agendaBlock = agendaStrict.block || agendaFromText.block || '（議題未検出：議事次第PDFをご確認ください）';

  // 最終整形
  const formatSpec = `
# 役割
あなたは「日本の行政会議（経産省 検討会等）の要約専門家」。

# 正規議題（議事次第PDFから抽出）
${agendaStrict.block || '(未検出)'}

# 重要：議題と配付資料の区別
- 議事次第PDFの「3. 議事」または「議事」セクション（開会、ヒアリング、閉会など）のみを「■議題」に記載
- 「4. 配付資料」や資料リスト（資料1、資料2など）は「■議題」に含めない
- 配付資料情報は別セクションで提供されるため省略

# 議題別要約の絶対ルール
- 正規議題に記載された全ての議題について、必ず個別に要約を記載すること
- 議題が関連していても統合禁止。各議題ごとに独立して記載すること
- 議題内容が薄い場合でも「・事務局から○○について説明」など最低1項目は記載すること
- 議題タイトルだけで内容が空の行は生成禁止
- 各議題には必ず具体的な内容を箇条書きで2項目以上記載すること

# 量的制約（絶対厳守・違反は不合格）
⚠️ 全体で2500文字を1文字でも超えたら不合格。必ず以下の上限を守ること。

【セクション別文字数上限】
- ■開催概要：150文字以内
- ■サマリ：150文字以内（必ず3行、各40-50文字）
- ■議題別要約：全議題合計で1800文字以内
  * 各議題の全体：最大300文字
  * 各議題の内容箇条書き：最大3項目（各30文字以内）
  * 各議題の委員コメント：最大2名（各40文字以内）
  * 各議題の事務局対応：1項目のみ（40文字以内）
- ■座長まとめ：80文字以内

※出力時に（）や【】などの指示記号は使用せず、実際の内容のみを記載すること

【簡潔化の徹底】
❌ 削除すべき表現：
「〜について」「〜に関して」「〜が説明された」「〜が示された」「〜とされた」
「喫緊の課題」「重要である」「必要である」などの形容・評価

✅ 簡潔化の例：
悪い：「2030年までの電源移行期における安定供給確保が喫緊の課題とされた。」（38文字）
良い：「2030年まで安定供給確保が課題。」（18文字）

悪い：「秋本委員：民間事業への国介入は慎重に。発電設備閉鎖には地元調整が必要。」（40文字）
良い：「秋本委員：国介入は慎重に、地元調整必要。」（22文字）

# 厳守する出力フォーマット
- 章見出しは必ず「■」で開始。罫線・順序は厳密に守る。文末は常体。敬称は省略。
- 委員名・所属は名簿に準拠（文字起こし側の誤記をそのまま使わない）。
- 不明は「（未記載）」で明示。捏造禁止。
- マークダウン記法（**太字**など）は一切使用禁止。すべて平文。

# 出力テンプレート
■${meeting.title}（${meeting.date || '日付未記載'}）
────────────────────────────
■開催概要（150文字以内）
・日時：${meeting.date || '（記載なし）'}
・形式：（オンライン／現地／ハイブリッド）
・出席者：座長名、委員名（3-5名を代表的に）、オブザーバー、事務局
────────────────────────────
■議題
${agendaBlock}
────────────────────────────
■サマリ（150文字以内、必ず3行）
・（要点1）
・（要点2）
・（要点3）
────────────────────────────
■議題別要約（全体で1800文字以内）

1.（議題タイトル）
・（要点1）
・（要点2）
・（要点3）

・委員A：（意見内容）
・委員B：（意見内容）
・事務局対応：（対応内容）

2.（議題タイトル）
...（同様の形式）

────────────────────────────
■座長まとめ（座長名）（80文字以内）
・（総括と方向性）
────────────────────────────

# 重要な書式ルール
- 議題内容の箇条書きは「・」（中黒）で開始
- 委員コメント部分の前には必ず空行を1行入れる
- 委員コメントは「・委員名：内容」の形式
- 議題番号は「1.」「2.」（半角数字 + 半角ピリオド）
- 罫線の長さは統一（全角20文字分）

# 入力資料
- 議事次第：\n${(agendaText || '').slice(0, 8000) || '（未取得）'}
- 委員名簿：\n${(rosterText || '').slice(0, 8000) || '（未取得）'}
- チャンク要約：\n${merged}
`;

  let final = callGemini_(key, CONFIG.GEMINI.MODEL, formatSpec) || '';
  Logger.log('[sum] final len=' + final.length);

  // 強制削減（2500文字制限）
  const TARGET_MAX = 2500;
  if (final.length > TARGET_MAX) {
    Logger.log(`⚠️ 文字数超過: ${final.length}文字 → 強制削減実行`);
    final = forceReduceSummary_(final, TARGET_MAX);
    Logger.log(`✅ 削減完了: ${final.length}文字`);
  }

  // 末尾罫線削除
  final = final.replace(/────+\s*$/, '').trim();
  
  // マークダウン記号削除
  final = final.replace(/\*\*/g, '').replace(/\*/g, '');

  return final.trim();
}

/**
 * 要約を強制的に指定文字数以内に削減
 */
function forceReduceSummary_(text, maxChars) {
  if (text.length <= maxChars) return text;
  
  Logger.log(`[forceReduce] 開始: ${text.length}文字 → 目標: ${maxChars}文字`);
  
  let result = text;
  
  // 1. 委員コメントを2名に制限
  result = limitCommentsPerAgenda_(result, 2);
  Logger.log(`[forceReduce] 委員制限後: ${result.length}文字`);
  
  if (result.length <= maxChars) return result;
  
  // 2. 各議題の箇条書きを3項目に制限
  result = limitBulletsPerAgenda_(result, 3);
  Logger.log(`[forceReduce] 箇条書き制限後: ${result.length}文字`);
  
  if (result.length <= maxChars) return result;
  
  // 3. 事務局対応を短縮
  result = shortenAdminResponses_(result);
  Logger.log(`[forceReduce] 事務局短縮後: ${result.length}文字`);
  
  if (result.length <= maxChars) return result;
  
  // 4. 最終手段：末尾から削除
  const excess = result.length - maxChars;
  Logger.log(`[forceReduce] ⚠️ 末尾削除: ${excess}文字`);
  result = result.slice(0, maxChars) + '\n...(以下略)';
  
  return result;
}

function limitCommentsPerAgenda_(text, maxComments) {
  const agendaPattern = /(\d+\..*?)\n([\s\S]*?)(?=\n\d+\.|────|■座長まとめ|$)/g;
  
  return text.replace(agendaPattern, (match, title, content) => {
    const lines = content.split('\n');
    const bulletLines = [];
    const commentLines = [];
    
    let inComments = false;
    for (const line of lines) {
      if (line.match(/^・.*?[委員|オブザーバー].*?：/)) {
        inComments = true;
        commentLines.push(line);
      } else if (line.match(/^・事務局対応：/)) {
        commentLines.push(line);
        break;
      } else if (!inComments && line.trim().startsWith('・')) {
        bulletLines.push(line);
      } else if (line.trim() === '') {
        if (inComments) break;
        bulletLines.push(line);
      }
    }
    
    const limitedComments = commentLines.slice(0, maxComments + 1);
    const newContent = [...bulletLines, '', ...limitedComments].join('\n');
    return title + '\n' + newContent;
  });
}

function limitBulletsPerAgenda_(text, maxBullets) {
  const agendaPattern = /(\d+\..*?\n)((?:・[^・]*?\n){1,})/g;
  
  return text.replace(agendaPattern, (match, title, bullets) => {
    const bulletList = bullets.match(/・[^・]*?\n/g) || [];
    const limited = bulletList.slice(0, maxBullets).join('');
    return title + limited;
  });
}

function shortenAdminResponses_(text) {
  return text.replace(/・事務局対応：(.{60,})/g, (match, content) => {
    const shortened = content.slice(0, 40);
    return `・事務局対応：${shortened}...`;
  });
}

function chunkText_(text, maxChars) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

function callGemini_(apiKey, _modelIgnored, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=' + apiKey;
  
  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    // セキュリティ監視：API使用カウンター
    if (typeof incrementGeminiCounter_ === 'function') {
      incrementGeminiCounter_();
    }
    
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    Logger.log(`[gemini v1] http=${code} url=${url.substring(0, 80)}...`);
    
    if (code !== 200) {
      // エラーカウンター
      if (typeof incrementRequestCounter_ === 'function') {
        incrementRequestCounter_(false);
      }
      return '';
    }
    
    const json = JSON.parse(res.getContentText());
    const txt = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    Logger.log(`[gemini v1] ok len=${txt.length}`);
    
    // 成功カウンター
    if (typeof incrementRequestCounter_ === 'function') {
      incrementRequestCounter_(true);
    }
    
    return txt;
  } catch (e) {
    Logger.log(`[gemini v1] error: ${e.message}`);
    // エラーカウンター
    if (typeof incrementRequestCounter_ === 'function') {
      incrementRequestCounter_(false);
    }
    return '';
  }
}

function cleanupSummaryLineBreaks_(text) {
  let result = text;
  result = result.replace(/(\d)\s+([億万千百十兆])/g, '$1$2');
  result = result.replace(/±\s*(\d)/g, '±$1');
  result = result.replace(/([、，])\s*([^\s])/g, '$1$2');
  result = result.replace(/([^\s])\s+([、，。）」])/g, '$1$2');
  result = result.replace(/([^\n])\n([^\n■・─])/g, '$1 $2');
  return result;
}

function extractAgendaStrictFromGijishidai_(agendaText) {
  if (!agendaText || agendaText.length < 10) {
    return { success: false, block: '', lines: [] };
  }

  const lines = agendaText.split('\n').map(ln => ln.trim()).filter(Boolean);
  const agendaLines = [];
  let capturing = false;

  for (const line of lines) {
    if (/^[0-9０-９１２３４５６７８９]+[\s　]*\.?[\s　]*議事/.test(line)) {
      capturing = true;
      continue;
    }
    if (/^[0-9０-９１２３４５６７８９]+[\s　]*\.?[\s　]*配付資料/.test(line)) {
      capturing = false;
      break;
    }
    if (capturing) {
      if (/^\([0-9０-９１２３４５６７８９]+\)|^[0-9０-９１２３４５６７８９]+\.|^・|^‣|^－/.test(line)) {
        agendaLines.push(line);
      }
    }
  }

  if (agendaLines.length === 0) {
    return { success: false, block: '', lines: [] };
  }

  const agendaBlock = agendaLines.map(ln => {
    if (!ln.match(/^[0-9０-９]/)) {
      return ln;
    }
    const normalized = ln.replace(/^[0-9０-９]+[\s　]*[\.\．\:：]?[\s　]*/, (m) => {
      const num = m.match(/[0-9０-９]+/)[0];
      const n = String(num).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
      return n + '. ';
    });
    return normalized;
  }).join('\n');

  return { success: true, block: agendaBlock, lines: agendaLines };
}

function extractAgendaFromText_(agendaText) {
  if (!agendaText) return { success: false, block: '' };
  
  const lines = agendaText.split('\n').map(ln => ln.trim()).filter(Boolean);
  const agendaLines = [];
  
  for (const line of lines) {
    if (line.match(/^[0-9０-９]+[\s\.．・・]+.{2,}/)) {
      agendaLines.push(line);
    }
  }
  
  if (agendaLines.length === 0) return { success: false, block: '' };
  
  return { success: true, block: agendaLines.join('\n') };
}

function extractAgendaSmartFromGijishidai_(agendaText) {
  const strict = extractAgendaStrictFromGijishidai_(agendaText);
  if (strict.success) return strict;
  
  const fromText = extractAgendaFromText_(agendaText);
  if (fromText.success) return fromText;
  
  return { success: false, block: '' };
}

function fallbackAgendaFromTitleOrPdfs_(meeting) {
  if (!meeting) return '';
  const topics = (meeting.pdfs || [])
    .filter(p => (p.refType === '資料' && p.refNo != null) || p.refType === '参考資料')
    .sort((a, b) => (a.refType === b.refType ? (a.refNo || 999) - (b.refNo || 999) : (a.refType === '資料' ? -1 : 1)))
    .map((p, i) => `${i + 1}．${p.title}【${p.refType}${p.refNo ?? ''}】`)
    .join('\n');
  
  return topics || '（議題未検出）';
}

function shouldSendSummary_(text) {
  if (!text || text.length < CONFIG.SUMMARY.MIN_CHARS) return false;
  if (!validateSummaryFormat_(text)) return false;
  return true;
}

function validateSummaryFormat_(text) {
  const required = ['■', '────'];
  return required.every(mark => text.includes(mark));
}

function cleanSummaryText_(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function isReportPage_(meeting) {
  if (!meeting) return false;
  const title = meeting.title || '';
  return /取りまとめ|まとめ|報告書|中間整理/.test(title);
}

/* ========================================================================== */
/* 6. メール送信                                                              */
/* ========================================================================== */

function buildMailWithSummary_(meeting, finalSummaryText, linksBlock, sourceTagOpt, agendaBlockOverride) {
  const sourceTag = sourceTagOpt || '不明';
  const REPORT = isReportPage_(meeting);

  const topics = (meeting.pdfs || [])
      .filter(p => (p.refType === '資料' && p.refNo != null) || p.refType === '参考資料')
      .sort((a, b) => (a.refType === b.refType ? (a.refNo || 999) - (b.refNo || 999) : (a.refType === '資料' ? -1 : 1)))
      .map((p, i) => `${i + 1}．${p.title}【${p.refType}${p.refNo ?? ''}】`)
      .join('\n');

  const fallbackNote = REPORT
    ? '※本メールは「資料公開（取りまとめ等）」の検知です。会議開催・動画配信は確認できないため、文字起こし・要約は行いません。PDF本文をご確認ください。'
    : '';
    
  const fallbackPlain = `■${meeting.title}
────────────────────────────
■開催概要
・日時：${meeting.date || '（記載なし）'}
・形式：記載なし
・出席者：委員名簿：${'(リンクは本文末)'}
────────────────────────────
■議題
${agendaBlockOverride || '（議題未検出：議事次第PDFの取得/OCRに失敗）'}
${REPORT ? '' : '────────────────────────────\n■座長まとめ\n・（未記載）'}
${REPORT ? '' : '\n（文字起こし取得後にサマリを再送します）'}
${fallbackNote ? '\n\n' + fallbackNote : ''}`;

  const summaryPlain = (finalSummaryText && finalSummaryText.trim()) ? cleanSummaryText_(finalSummaryText.trim()) : fallbackPlain;

  const linksBlockFormatted = linksBlock 
    ? linksBlock.split('\n').map(line => line.trim()).filter(Boolean).join('\n')
    : '';

  const baseLinks = `■リンク
・会議ページ：${meeting.pageUrl}
${meeting.youtube ? `・動画：${meeting.youtube}` : ''}
${linksBlockFormatted}`;

  // プレーンテキスト用のdisclaimer
  const disclaimerPlain = `
本内容はAIにより作成しているため元動画・資料での最終確認をお願いいたします。本サービスはβ版のため随時アップデートしているとともに予告なく終了する場合があります。ご要望や監視対象の会議追加については、info@klammer.co.jpまでご連絡ください。`;

  const plain = summaryPlain.replace(/────+\s*$/, '').trim() + '\n\n' + baseLinks + '\n' + disclaimerPlain;

  // HTML整形
  const preheader = extractPreheaderOneLine_(summaryPlain) || `${meeting.title} の要約`;
  const htmlMain = renderHtmlFromSummaryPlain_(summaryPlain);
  
  const htmlLinks = `
    <div style="margin-top:20px; font-size:14px; color:#111;">
      <strong>■リンク</strong><br>
      ${autoLinkHtml_(escapeHtml_(baseLinks.replace('■リンク\n', ''))).replace(/\n/g, '<br>')}
    </div>`;
  
  const disclaimer = `<p style="margin-top:16px; font-size:12px; color:#666;">
    本内容はAIにより作成しているため元動画・資料での最終確認をお願いいたします。本サービスはβ版のため随時アップデートしているとともに予告なく終了する場合があります。ご要望や監視対象の会議追加については、info@klammer.co.jpまでご連絡ください。
  </p>`;

  const htmlBody =
      '<div style="font-family:system-ui,Meiryo,Segoe UI,Roboto,sans-serif; line-height:1.7; color:#111;">' +
        `<div style="font-size:0;opacity:0;height:0;line-height:0;display:none;visibility:hidden;">${escapeHtml_(preheader)}</div>` +
        htmlMain + '<hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;">' +
        htmlLinks + disclaimer +
      '</div>';

  const baseTag = (finalSummaryText && finalSummaryText.trim())
    ? '会議要約'
    : (REPORT ? 'レポート' : '会議検知');

  const displayTitle = meeting.title.length > 50 
    ? meeting.title.substring(0, 50) + '...'
    : meeting.title;
    
  const subject = `[${baseTag}] ${displayTitle}（${meeting.date || '日付未記載'}）`;

  return { subject, plain, htmlBody };
}

function renderHtmlFromSummaryPlain_(plain) {
  let html = '';
  const lines = plain.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('■')) {
      html += `<h2 style="font-size:16px; font-weight:bold; margin:20px 0 10px; color:#111;">${escapeHtml_(line)}</h2>`;
    } else if (line.startsWith('────')) {
      html += '<hr style="margin:10px 0; border:none; border-top:1px solid #e5e7eb;">';
    } else if (line.trim()) {
      html += `<p style="margin:6px 0; line-height:1.6;">${escapeHtml_(line)}</p>`;
    }
  }
  
  return html;
}

function extractPreheaderOneLine_(text) {
  const lines = text.split('\n').filter(ln => ln.trim() && !ln.startsWith('■') && !ln.startsWith('────'));
  return lines[0] ? lines[0].substring(0, 100) : '';
}

function autoLinkHtml_(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1" style="color:#667eea; text-decoration:underline;">$1</a>');
}

function escapeHtml_(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function injectFooterHtml_(htmlBody, unsubUrl, resubUrl) {
  const sourcesListUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?page=sources`;
  
  const footer = `
    <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #eee; text-align: center; font-size: 13px; color: #666;">
      <p style="margin: 10px 0;">
        <a href="${unsubUrl}" style="color: #667eea; text-decoration: underline; margin: 0 10px;">配信停止</a> | 
        <a href="${resubUrl}" style="color: #667eea; text-decoration: underline; margin: 0 10px;">再登録</a> | 
        <a href="${sourcesListUrl}" style="color: #667eea; text-decoration: underline; margin: 0 10px;">監視対象会議</a>
      </p>
      <p style="margin-top: 15px; color: #999; font-size: 12px;">© Klammer Inc.</p>
    </div>
  `;
  
  if (htmlBody.includes('</body>')) {
    return htmlBody.replace('</body>', footer + '</body>');
  } else {
    return htmlBody + footer;
  }
}

function sendToRecipients_(recipients, subject, plainText, htmlBody) {
  const from = PropertiesService.getScriptProperties().getProperty('MAIL_FROM') || Session.getActiveUser().getEmail();
  const fromName = PropertiesService.getScriptProperties().getProperty('MAIL_FROM_NAME') || '政府会議ウォッチャー';

  recipients.forEach(addr => {
    try {
      MailApp.sendEmail({
        to: addr,
        subject,
        body: plainText,
        htmlBody: htmlBody,
        name: fromName,
        replyTo: from
      });
      Logger.log('Mail sent to: ' + addr);
    } catch (e) {
      Logger.log('Mail error to ' + addr + ': ' + e.message);
    }
  });
}

function shouldSkipDuplicateV2_(meetingUrl, userEmail) {
  const key = 'sent_' + Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, meetingUrl + userEmail)
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'))
    .join('');
  
  const cache = CacheService.getScriptCache();
  const cached = cache.get(key);
  
  if (cached) {
    return true;
  }
  
  cache.put(key, '1', 86400 * 30);  // 30日
  return false;
}

/* ========================================================================== */
/* 7. ユーザー管理（購読者）                                                 */
/* ========================================================================== */

function ensureRecipientsSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.RECIPIENTS.SHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.RECIPIENTS.SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.RECIPIENTS.SHEET_NAME);
    sheet.getRange('A1:D1').setValues([['email', 'status', 'sources', 'token']]);
  }
  
  return sheet;
}

function hmacToken_(email) {
  const em = String(email || '').trim().toLowerCase();
  const sig = Utilities.computeHmacSha256Signature(em, CONFIG.APP.SECRET);
  const b64 = Utilities.base64Encode(sig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64;
}

function upsertRecipient_(email, sources='*', status='active') {
  const sheet = ensureRecipientsSheet_();
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[status, sources]]);
      return;
    }
  }
  
  const token = hmacToken_(email);
  sheet.appendRow([email, status, sources, token]);
}

function normalizeSourceName_(name) {
  return name.replace(/\s+/g, '').toLowerCase();
}

function getRecipientsForSource_(sourceName) {
  const sheet = ensureRecipientsSheet_();
  const data = sheet.getDataRange().getValues();
  const results = [];
  const normalized = normalizeSourceName_(sourceName);
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const email = String(row[0] || '').trim();
    const status = String(row[1] || '').trim();
    const sources = String(row[2] || '').trim();
    const token = String(row[3] || '').trim();
    
    if (!email || status !== 'active') continue;
    
    if (sources === '*') {
      results.push({ email, sources, token });
      continue;
    }
    
    const sourceList = sources.split(',').map(s => normalizeSourceName_(s.trim()));
    if (sourceList.includes(normalized)) {
      results.push({ email, sources, token });
    }
  }
  
  return results;
}

/* ========================================================================== */
/* 8. Archive管理                                                             */
/* ========================================================================== */

function isAlreadyArchived(sourceId, meetingNumber) {
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.ARCHIVE.SHEET_ID)
      .getSheetByName(CONFIG.ARCHIVE.SHEET_NAME);
    
    if (!sheet) {
      Logger.log('[isAlreadyArchived] archiveシートが見つかりません');
      return false;
    }
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const archivedSourceId = row[1];
      const archivedMeetingNumber = row[4];
      
      if (archivedSourceId === sourceId && archivedMeetingNumber === meetingNumber) {
        return true;
      }
    }
    
    return false;
  } catch (e) {
    Logger.log('[isAlreadyArchived] エラー: ' + e.message);
    return false;
  }
}

function saveToArchive_(sourceId, sourceName, agency, meetingNumber, meetingData, summary, summaryChars, sourceType) {
  Logger.log('[DEBUG] saveToArchive_ 関数開始');
  
  try {
    Logger.log('[DEBUG] シート取得中...');
    const sheet = SpreadsheetApp.openById(CONFIG.ARCHIVE.SHEET_ID)
      .getSheetByName(CONFIG.ARCHIVE.SHEET_NAME);
    
    if (!sheet) {
      Logger.log('[ERROR] archiveシートが見つかりません');
      return;
    }
    Logger.log('[DEBUG] シート取得完了: OK');
    
    const data = sheet.getDataRange().getValues();
    const nextId = data.length;
    Logger.log('[DEBUG] 次のID: ' + nextId);
    
    const now = new Date().toISOString();
    
    sheet.appendRow([
      nextId,
      sourceId,
      sourceName,
      agency,
      meetingNumber,
      meetingData.date || '',
      meetingData.title || '',
      meetingData.url || '',
      meetingData.youtube || '',
      meetingData.agendaPdfUrl || '',
      meetingData.rosterPdfUrl || '',
      summary,
      summaryChars,
      sourceType,
      now,
      now
    ]);
    
    Logger.log(`✅ archiveに保存: ${meetingData.title}`);
  } catch (e) {
    Logger.log('[ERROR] saveToArchive_: ' + e.message);
  }
}

/* ========================================================================== */
/* 9. ユーティリティ関数                                                     */
/* ========================================================================== */

function loadState_() {
  const json = PropertiesService.getScriptProperties().getProperty(CONFIG.STORE_KEY);
  return json ? JSON.parse(json) : {};
}

function saveState_(obj) {
  PropertiesService.getScriptProperties().setProperty(CONFIG.STORE_KEY, JSON.stringify(obj));
}

function toDir_(url) { 
  return url.replace(/[#?].*$/, '').replace(/\/[^/]*$/, '/'); 
}

function absoluteUrl_(baseDir, href) {
  if (href.startsWith('http')) return href;
  if (href.startsWith('/')) return baseDir.replace(/^(https?:\/\/[^/]+).*/, '$1') + href;
  return baseDir + href;
}

function match1_(s, re) { 
  const m = s.match(re); 
  return m ? m[1].trim() : ''; 
}

function sanitize_(t) {
  return t.replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function normalizeNum_(s) {
  return parseInt(String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)), 10);
}

/* ========================================================================== */
/* 10. 本番テスト・デバッグ用関数                                             */
/* ========================================================================== */

/**
 * 指定した会議の最新回をテスト送信（本番前確認用）
 */
function sendLatestMeetingTest(sourceIds) {
  const sources = getSources_();
  
  let targetSources = [];
  
  if (!sourceIds) {
    targetSources = [sources[0]];
  } else if (sourceIds === 'all') {
    targetSources = sources;
  } else if (Array.isArray(sourceIds)) {
    targetSources = sources.filter(s => sourceIds.includes(s.id));
  } else {
    targetSources = sources.filter(s => s.id === sourceIds);
  }
  
  if (!targetSources.length) {
    Logger.log('❌ 対象の会議が見つかりません');
    return;
  }
  
  Logger.log(`\n=== テスト送信: ${targetSources.length}会議 ===\n`);
  
  targetSources.forEach((src, index) => {
    Logger.log(`\n[${index + 1}/${targetSources.length}] [ID=${src.id}] ${src.name}`);
    Logger.log('─────────────────────────────────────');
    
    const baseDir = toDir_(src.indexUrl);
    const html = fetchText_(src.indexUrl);
    
    if (!html) {
      Logger.log('❌ ページ取得失敗');
      return;
    }
    
    const pages = extractMeetingPages_(html, baseDir);
    if (!pages.length) {
      Logger.log('❌ 会議ページが見つかりません');
      return;
    }
    
    const latest = pages[0];
    Logger.log(`📄 最新回: 第${latest.id}回, URL: ${latest.url}`);
    
    if (isAlreadyArchived(src.id, latest.id)) {
      Logger.log('⚠️ 既に送信済みのためスキップ');
      return;
    }
    
    const mt = scrapeMeetingPage_(latest.url);
    
    if (!isMeetingPageLikelyValid_(mt)) {
      Logger.log('⚠️ ページがまだ公開されていない可能性があります');
      return;
    }
    
    Logger.log(`タイトル: ${mt.title}`);
    Logger.log(`日付: ${mt.date || '未記載'}`);
    Logger.log(`YouTube: ${mt.youtube || 'なし'}`);
    Logger.log(`PDF数: ${mt.pdfs.length}`);
    
    const agendaPdf = mt.pdfs.find(x => x.isAgenda);
    const rosterPdf = mt.pdfs.find(x => x.isRoster);
    
    let agendaText = '', rosterText = '';
    if (agendaPdf) {
      Logger.log('📄 議事次第PDF取得中...');
      agendaText = extractPdfTextViaVps_(agendaPdf.url);
      Logger.log(`  取得: ${agendaText.length}文字`);
    }
    if (rosterPdf) {
      Logger.log('📄 委員名簿PDF取得中...');
      rosterText = extractPdfTextViaVps_(rosterPdf.url);
      Logger.log(`  取得: ${rosterText.length}文字`);
    }
    
    let transcript = '';
    let transcriptSource = 'なし';
    if (mt.youtube) {
      Logger.log('🎥 字幕取得中...');
      const r = fetchSubsViaVps_(mt.youtube);
      transcript = r || '';
      transcriptSource = transcript ? 'YouTube字幕（VPS/yt-dlp）' : 'なし';
      Logger.log(`  取得: ${transcript.length}文字 (${transcriptSource})`);
    }
    
    transcript = cleanTranscript_(transcript);
    
    let finalSummary = '';
    if (transcript && !isReportPage_(mt)) {
      Logger.log('🤖 要約生成中...');
      finalSummary = summarizeMeeting_(mt, agendaText, rosterText, transcript) || '';
      Logger.log(`  生成: ${finalSummary.length}文字`);
    }
    
    const sendSummary = shouldSendSummary_(finalSummary);
    const finalToSend = sendSummary ? finalSummary : '';
    
    if (!sendSummary) {
      Logger.log('⚠️ 要約の品質が低いため送信スキップ');
    }
    
    const sourceTag = transcript ? transcriptSource : (isReportPage_(mt) ? 'レポート' : 'ASR予定');
    const agendaSmart = extractAgendaSmartFromGijishidai_(agendaText || '');
    const agendaBlock = agendaSmart.block || fallbackAgendaFromTitleOrPdfs_(mt) || '';
    
    const { subject, plain, htmlBody } = buildMailWithSummary_(
      mt, 
      finalToSend, 
      buildLinksBlock_(mt, agendaPdf, rosterPdf), 
      sourceTag, 
      agendaBlock
    );
    
    const recObjs = getRecipientsForSource_(src.name);
    
    if (!recObjs.length) {
      Logger.log('⚠️ 購読者が登録されていません');
      return;
    }
    
    Logger.log(`📧 送信先: ${recObjs.length}名`);
    
    recObjs.forEach(r => {
      const unsubUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?action=unsubscribe&token=${encodeURIComponent(r.token)}&email=${encodeURIComponent(r.email)}&source=${encodeURIComponent(src.name)}`;
      const resubUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?action=resub&token=${encodeURIComponent(r.token)}&email=${encodeURIComponent(r.email)}&source=${encodeURIComponent(src.name)}`;
      const sourcesListUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?page=sources`;
      
      const footer = `
――――――――――――
配信設定: 停止 ${unsubUrl}
再登録: ${resubUrl}
監視対象会議: ${sourcesListUrl}

© Klammer Inc.`;
      
      const plainPerUser = plain + footer;
      const htmlPerUser = injectFooterHtml_(htmlBody, unsubUrl, resubUrl);
      
      Logger.log(`  → ${r.email}`);
      sendToRecipients_([r.email], '[テスト] ' + subject, plainPerUser, htmlPerUser);
    });
    
    Logger.log('✅ 送信完了');
    
    Logger.log('[DEBUG] saveToArchive_ 呼び出し開始');
    Logger.log('[DEBUG] src.id=' + src.id + ', latest.id=' + latest.id);
    
    saveToArchive_(
      src.id,
      src.name,
      src.agency || '経済産業省',
      latest.id,
      {
        date: mt.date,
        title: mt.title,
        url: latest.url,
        youtube: mt.youtube,
        agendaPdfUrl: agendaPdf ? agendaPdf.url : '',
        rosterPdfUrl: rosterPdf ? rosterPdf.url : ''
      },
      finalToSend,
      finalToSend.length,
      sourceTag
    );
    
    Logger.log('[DEBUG] saveToArchive_ 呼び出し完了');
  });
  
  Logger.log(`\n\n🎉 全体完了: ${targetSources.length}会議のテスト送信が完了しました`);
}

/**
 * 失敗した会議の再テスト
 */
function retestFailedMeetings() {
  Logger.log('=== 失敗していた会議の再テスト ===\n');
  
  Logger.log('\n[1/3] 発電ベンチマーク');
  sendLatestMeetingTest(5);
  
  Utilities.sleep(10000);
  
  Logger.log('\n[2/3] グリーン鉄');
  sendLatestMeetingTest(6);
  
  Utilities.sleep(10000);
  
  Logger.log('\n[3/3] 分散型');
  sendLatestMeetingTest(7);
}

/**
 * フッター確認用クイックテスト
 */
function quickMailTest() {
  const testSubject = '[テスト] フッター確認用';
  const testBody = `
■テスト会議
────────────────────────────
■開催概要
・日時：2025年11月11日
・形式：テスト
────────────────────────────
■リンク
・会議ページ：https://example.com
本内容はAIにより作成しているため元動画・資料での最終確認をお願いいたします。本サービスはβ版のため随時アップデートしているとともに予告なく終了する場合があります。ご要望や監視対象の会議追加については、info@klammer.co.jp​までご連絡ください。
  `.trim();
  
  const testHtml = `
<div style="font-family:system-ui,sans-serif;">
  <h2>テストメール</h2>
  <p>これはフッター確認用のテストメールです。</p>
</div>
  `;
  
  const sources = getSources_();
  const src = sources[0];
  const recObjs = getRecipientsForSource_(src.name);
  
  if (!recObjs.length) {
    Logger.log('❌ 購読者なし');
    return;
  }
  
  const r = recObjs[0];
  
  const unsubUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?action=unsubscribe&token=${encodeURIComponent(r.token)}&email=${encodeURIComponent(r.email)}&source=${encodeURIComponent(src.name)}`;
  const resubUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?action=resub&token=${encodeURIComponent(r.token)}&email=${encodeURIComponent(r.email)}&source=${encodeURIComponent(src.name)}`;
  const sourcesListUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?page=sources`;
  
  const footer = `
――――――――――――
配信設定: 停止 ${unsubUrl}
再登録: ${resubUrl}
監視対象会議: ${sourcesListUrl}

© Klammer Inc.`;
  
  const plainPerUser = testBody + footer;
  const htmlPerUser = injectFooterHtml_(testHtml, unsubUrl, resubUrl);
  
  Logger.log('=== フッター確認 ===');
  Logger.log('sourcesListUrl: ' + sourcesListUrl);
  Logger.log('\n=== plainPerUserの最後200文字 ===');
  Logger.log(plainPerUser.slice(-200));
  Logger.log('\n=== htmlPerUserの最後400文字 ===');
  Logger.log(htmlPerUser.slice(-400));
  
  sendToRecipients_([r.email], testSubject, plainPerUser, htmlPerUser);
  
  Logger.log('\n✅ テストメール送信完了: ' + r.email);
}

/**
 * 購読者確認
 */
function checkRecipients() {
  const sources = getSources_();
  
  Logger.log('=== 購読者確認 ===\n');
  
  sources.forEach(src => {
    const recipients = getRecipientsForSource_(src.name);
    Logger.log(`[${src.id}] ${src.name}: ${recipients.length}名`);
    recipients.forEach(r => {
      Logger.log(`  - ${r.email}`);
    });
  });
}

/**
 * 監視状況の確認
 */
function showMonitoringStatus() {
  const sources = getSources_();
  const state = loadState_();
  
  Logger.log('=== 監視状況 ===\n');
  
  sources.forEach(src => {
    const srcState = state[src.indexUrl] || {};
    const lastChecked = srcState.lastCheckedAt || '未チェック';
    const lastId = srcState.lastId || '未記録';
    const lastSent = srcState.lastSent || '未送信';
    
    Logger.log(`[${src.id}] ${src.name}`);
    Logger.log(`  最終チェック: ${lastChecked}`);
    Logger.log(`  最終処理回: 第${lastId}回`);
    Logger.log(`  最終送信: ${lastSent}`);
    Logger.log('');
  });
}

/**
 * 個別会議の詳細確認
 */
function showSourceStatus(id) {
  const sources = getSources_();
  const src = sources.find(s => s.id === id);
  
  if (!src) {
    Logger.log('❌ 指定されたIDの会議が見つかりません');
    return;
  }
  
  Logger.log(`=== ${src.name} の詳細 ===\n`);
  Logger.log(`ID: ${src.id}`);
  Logger.log(`所管: ${src.agency}`);
  Logger.log(`URL: ${src.indexUrl}`);
  
  const html = fetchText_(src.indexUrl);
  if (!html) {
    Logger.log('❌ ページ取得失敗');
    return;
  }
  
  const baseDir = toDir_(src.indexUrl);
  const pages = extractMeetingPages_(html, baseDir);
  
  Logger.log(`\n検出された会議: ${pages.length}回`);
  pages.slice(0, 5).forEach(p => {
    Logger.log(`  第${p.id}回: ${p.url}`);
  });
  
  const recipients = getRecipientsForSource_(src.name);
  Logger.log(`\n購読者: ${recipients.length}名`);
  recipients.forEach(r => {
    Logger.log(`  - ${r.email}`);
  });
}

/**
 * トークン再生成（hmacToken_関数変更時に実行）
 */
function regenerateAllTokens() {
  const sheet = SpreadsheetApp.openById(CONFIG.RECIPIENTS.SHEET_ID)
    .getSheetByName(CONFIG.RECIPIENTS.SHEET_NAME);
  
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const email = data[i][0];
    if (email) {
      const newToken = hmacToken_(email);
      sheet.getRange(i + 1, 4).setValue(newToken);  // D列（token列）
    }
  }
  
  Logger.log('✅ 全トークン再生成完了');
}

// GASに実装
function rotateTokens() {
  // 1週間に1回トークンを更新
  // 古いトークンは24時間の猶予期間後に無効化
}




/*  デバッグ用 */
// ===== パターン2: 特定のID（1つ） =====
function testSend2() {
  sendLatestMeetingTest(2);  // ID=3の会議のみ
}

// GASで実行
function testRateLimiting() {
  Logger.log('=== Rate Limiting テスト ===\n');
  
  const testEmail = 'test@example.com';
  const testAction = 'unsubscribe';
  
  // 11回連続でチェック（10回が制限）
  for (let i = 1; i <= 11; i++) {
    const allowed = checkRateLimit_(testEmail, testAction);
    Logger.log(`${i}回目: ${allowed ? '✅ 許可' : '❌ 制限'}`);
  }
  
  Logger.log('\n=== テスト完了 ===');
  Logger.log('10回目まで許可、11回目で制限されればOK');
}

// GASで実行
function testSecurityLogging() {
  Logger.log('=== セキュリティログ テスト ===\n');
  
  // 正常なログ
  logSecurityEvent_('test_action', 'test@example.com', 'success');
  Logger.log('✅ 正常ログ記録完了');
  
  // 異常なログ（アラートが飛ぶ）
  logSecurityEvent_('test_action', 'test@example.com', 'rate_limit_exceeded', { count: 15 });
  Logger.log('⚠️ 異常ログ記録完了（管理者にメール送信される）');
  
  Logger.log('\n=== テスト完了 ===');
  Logger.log('メールボックスをチェックしてください');
}

// GASで実行
function testCounters() {
  Logger.log('=== カウンター テスト ===\n');
  
  // カウンターを増やす
  incrementRequestCounter_(true);   // 成功
  incrementRequestCounter_(true);   // 成功
  incrementRequestCounter_(false);  // 失敗
  incrementGeminiCounter_();        // Gemini使用
  incrementGeminiCounter_();        // Gemini使用
  incrementRateLimitCounter_();     // Rate limit違反
  
  Logger.log('カウンターを更新しました');
  Logger.log('\n次にダッシュボードを表示:');
  
  // ダッシュボードで確認
  showSecurityDashboard();
}