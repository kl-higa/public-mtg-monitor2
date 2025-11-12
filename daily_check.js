/**
 * VPS連携型の定期チェック処理
 * 
 * 【機能】
 * - GASで新着会議を検知
 * - 検知した会議データをVPSに送信
 * - VPS側でOCR・字幕取得・要約生成
 * - 完了後、VPSからGASにメール送信依頼（doPost経由）
 * 
 * 【実行】
 * トリガーで毎日実行（例: 08:00 JST）
 */

/* ========================================================================== */
/* 1. 本番用定期チェック（VPS連携）                                           */
/* ========================================================================== */

/**
 * VPS連携: 全会議の新着をチェックしてVPSに送信
 * 毎日実行される本番処理
 */
function dailyCheckAllVps() {
  try {
    Logger.log('=== VPS連携: 新着チェック開始 ===\n');
    
    const state = loadState_();
    const sources = getSources_();
    
    let totalNew = 0;
    let totalSent = 0;
    
    for (const src of sources) {
      Logger.log(`[${src.id}] ${src.name}`);
      
      try {
        // ページ取得
        const html = fetchText_(src.indexUrl);
        if (!html) {
          Logger.log('  ❌ ページ取得失敗');
          continue;
        }
        
        const pages = extractMeetingPages_(html, toDir_(src.indexUrl));
        if (!pages.length) {
          Logger.log('  ⚠️ 会議ページなし');
          continue;
        }
        
        // 初回シード
        if (!state[src.indexUrl]?.lastId) {
          state[src.indexUrl] = {
            lastId: pages[0].id,
            lastUrl: pages[0].url,
            lastCheckedAt: new Date().toISOString()
          };
          Logger.log(`  📌 初回シード: ID=${pages[0].id}`);
          saveState_(state);
          continue;
        }
        
        const lastId = state[src.indexUrl].lastId;
        const newcomers = pages.filter(p => p.id > lastId).sort((a, b) => a.id - b.id);
        
        if (!newcomers.length) {
          Logger.log('  ✅ 新着なし');
          continue;
        }
        
        Logger.log(`  📬 新着: ${newcomers.length}件`);
        totalNew += newcomers.length;
        
        // 新着をVPSに送信
        for (const p of newcomers) {
          const mt = scrapeMeetingPage_(p.url);
          
          if (!isMeetingPageLikelyValid_(mt)) {
            Logger.log(`    ⚠️ ID=${p.id} ページ未完成`);
            continue;
          }
          
          // PDF情報取得
          const agendaPdf = mt.pdfs.find(x => x.isAgenda);
          const rosterPdf = mt.pdfs.find(x => x.isRoster);
          
          // VPSに送信
          const result = sendToVpsForProcessing_({
            gasWebhook: CONFIG.APP.BASE_WEBAPP_URL,
            sourceData: {
              id: src.id,
              name: src.name,
              agency: src.agency
            },
            meetingData: {
              title: mt.title,
              date: mt.date,
              youtubeUrl: mt.youtube,
              agendaPdfUrl: agendaPdf?.url || "",
              rosterPdfUrl: rosterPdf?.url || "",
              pageUrl: p.url,
              meetingNumber: p.id
            }
          });
          
          if (result.ok) {
            Logger.log(`    ✅ ID=${p.id} VPS送信成功`);
            totalSent++;
            
            // 状態更新
            state[src.indexUrl].lastId = p.id;
            state[src.indexUrl].lastUrl = p.url;
            state[src.indexUrl].lastCheckedAt = new Date().toISOString();
            saveState_(state);
          } else {
            Logger.log(`    ❌ ID=${p.id} VPS送信失敗: ${result.error}`);
          }
        }
        
      } catch (e) {
        Logger.log(`  ❌ エラー: ${e.message}`);
      }
    }
    
    Logger.log(`\n✅ 完了: 新着${totalNew}件 / 送信${totalSent}件`);
    
  } catch (e) {
    Logger.log(`❌ 致命的エラー: ${e.message}`);
    
    // エラー通知
    try {
      notifyError_(e.message, 'dailyCheckAllVps', {
        stack: e.stack
      });
    } catch (notifyErr) {
      Logger.log(`通知エラー: ${notifyErr.message}`);
    }
    
    throw e;
  }
}

/* ========================================================================== */
/* 2. VPS連携関数                                                             */
/* ========================================================================== */

/**
 * VPSに会議データを送信
 * VPS側で処理完了後、GASにメール送信依頼が返ってくる
 */
function sendToVpsForProcessing_(data) {
  const VPS_URL = 'https://fetch.klammer.co.jp/meeting/process';
  const TOKEN = PropertiesService.getScriptProperties().getProperty('VPS_FETCH_TOKEN');
  
  try {
    const response = UrlFetchApp.fetch(VPS_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + TOKEN },
      payload: JSON.stringify(data),
      muteHttpExceptions: true
    });
    
    const code = response.getResponseCode();
    if (code === 200) {
      return { ok: true };
    } else {
      return { ok: false, error: `HTTP ${code}` };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
