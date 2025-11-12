/**
 * VPS連携のテスト関数
 */
function testVpsFlow() {
  Logger.log('=== VPS連携テスト ===\n');
  
  const sources = getSources_();
  const src = sources[0]; // 最初の会議でテスト
  
  Logger.log(`会議: ${src.name}`);
  
  // 1. ページ取得
  const html = fetchText_(src.indexUrl);
  const pages = extractMeetingPages_(html, toDir_(src.indexUrl));
  const mt = scrapeMeetingPage_(pages[0].url);
  
  Logger.log(`タイトル: ${mt.title}`);
  Logger.log(`YouTube: ${mt.youtube}`);
  
  // 2. PDF情報取得
  const agendaPdf = mt.pdfs.find(x => x.isAgenda);
  const rosterPdf = mt.pdfs.find(x => x.isRoster);
  
  // 3. VPSに送信
  const VPS_URL = 'https://fetch.klammer.co.jp/meeting/process';
  const TOKEN = PropertiesService.getScriptProperties().getProperty('VPS_FETCH_TOKEN');
  
  const gasWebhookUrl = CONFIG.APP.BASE_WEBAPP_URL; // ← 本番URLを使う
  Logger.log(`\n📡 GAS Webhook URL: ${gasWebhookUrl || '未設定'}`);
  
  const payload = {
    gasWebhook: gasWebhookUrl,
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
      pageUrl: pages[0].url,
      meetingNumber: pages[0].id
    }
  };
  
  Logger.log('\n📤 VPSに送信中...');
  
  try {
    const response = UrlFetchApp.fetch(VPS_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + TOKEN },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const code = response.getResponseCode();
    const result = JSON.parse(response.getContentText());
    
    Logger.log(`\n📥 VPS応答: ${code}`);
    Logger.log(JSON.stringify(result, null, 2));
    
    if (code === 200 || code === 202) {  // ← 202も成功とみなす
      Logger.log('\n✅ VPS連携テスト成功！');
      if (code === 202) {
        Logger.log('⏳ VPSでバックグラウンド処理中...');
        Logger.log('📧 処理完了後、自動的にメールが送信されます');
      }
    } else {
      Logger.log('\n⚠️ VPS連携エラー');
    }
    
  } catch (e) {
    Logger.log('\n❌ VPS通信エラー: ' + e.message);
  }
}
