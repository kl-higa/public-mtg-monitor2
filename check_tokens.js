/**
 * VPS接続とトークン確認用ユーティリティ（開発・デバッグ用）
 * 
 * 【機能】
 * - Script Propertiesに設定したトークンの確認
 * - VPS各エンドポイントへの接続テスト
 * 
 * 【使い方】
 * - checkAllTokens() → 全トークンを確認
 * - testAllVpsConnections() → 全VPS接続をテスト
 */

/* ========================================================================== */
/* 1. トークン確認                                                            */
/* ========================================================================== */

/**
 * ASR_TOKENの確認
 */
function checkAsrToken() {
  Logger.log('=== ASR_TOKEN確認 ===\n');
  
  const token = PropertiesService.getScriptProperties().getProperty('ASR_TOKEN');
  
  if (token) {
    Logger.log('✅ ASR_TOKEN is set');
    Logger.log('Token (first 20 chars): ' + token.substring(0, 20) + '...');
    Logger.log('Token length: ' + token.length);
  } else {
    Logger.log('❌ ASR_TOKEN is NOT set');
  }
}

/**
 * VPS_FETCH_TOKENの確認
 */
function checkVpsFetchToken() {
  Logger.log('=== VPS_FETCH_TOKEN確認 ===\n');
  
  const token = PropertiesService.getScriptProperties().getProperty('VPS_FETCH_TOKEN');
  
  if (token) {
    Logger.log('✅ VPS_FETCH_TOKEN is set');
    Logger.log('Token (first 20 chars): ' + token.substring(0, 20) + '...');
    Logger.log('Token length: ' + token.length);
  } else {
    Logger.log('❌ VPS_FETCH_TOKEN is NOT set');
  }
}

/**
 * 全トークンの一括確認
 */
function checkAllTokens() {
  Logger.log('====================================');
  Logger.log('全トークン確認');
  Logger.log('====================================\n');
  
  checkAsrToken();
  Logger.log('');
  
  checkVpsFetchToken();
  Logger.log('');
  
  const baseUrl = PropertiesService.getScriptProperties().getProperty('VPS_FETCH_BASE');
  if (baseUrl) {
    Logger.log('✅ VPS_FETCH_BASE: ' + baseUrl);
  } else {
    Logger.log('❌ VPS_FETCH_BASE is NOT set');
  }
  
  Logger.log('\n====================================');
}

/**
 * 単純なトークン確認（古い関数、互換性のため残す）
 */
function checkToken() {
  const TOKEN = PropertiesService.getScriptProperties().getProperty('ASR_TOKEN');
  Logger.log('ASR_TOKEN = ' + TOKEN);
}

/* ========================================================================== */
/* 2. VPS接続テスト                                                           */
/* ========================================================================== */

/**
 * VPS OCRエンドポイントへの接続テスト
 */
function testVpsOcrConnection() {
  Logger.log('=== VPS OCR接続テスト ===\n');
  
  const VPS_URL = 'https://fetch.klammer.co.jp/ocr';
  const TOKEN = PropertiesService.getScriptProperties().getProperty('ASR_TOKEN');
  
  if (!TOKEN) {
    Logger.log('❌ ASR_TOKEN not set. Please set it first.');
    return;
  }
  
  Logger.log('VPS URL: ' + VPS_URL);
  Logger.log('Token (first 20 chars): ' + TOKEN.substring(0, 20) + '...');
  Logger.log('\n📤 接続テスト中...\n');
  
  // 無効なPDF URLでテスト（接続確認が目的）
  const payload = {
    url: 'https://example.com/test.pdf',
    lang: 'jpn'
  };
  
  try {
    const response = UrlFetchApp.fetch(VPS_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + TOKEN },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const code = response.getResponseCode();
    const result = response.getContentText();
    
    Logger.log('📥 HTTP Status: ' + code);
    Logger.log('Response: ' + result.substring(0, 500));
    
    if (code === 200 || code === 400) {
      Logger.log('\n✅ 接続成功！VPSは応答しています。');
      Logger.log('   （400エラーは予想どおりです - 無効なPDF URLのため）');
    } else if (code === 401) {
      Logger.log('\n⚠️ 認証エラー - ASR_TOKENが無効です');
    } else if (code === 403) {
      Logger.log('\n⚠️ アクセス拒否 - ASR_TOKENに権限がありません');
    } else {
      Logger.log('\n⚠️ 予期しないエラー');
    }
    
  } catch (e) {
    Logger.log('\n❌ 接続エラー: ' + e.message);
  }
}

/**
 * VPS ASRエンドポイントへの接続テスト
 */
function testVpsAsrConnection() {
  Logger.log('=== VPS ASR接続テスト ===\n');
  
  const token = PropertiesService.getScriptProperties().getProperty('VPS_FETCH_TOKEN');
  const baseUrl = PropertiesService.getScriptProperties().getProperty('VPS_FETCH_BASE');
  
  if (!token || !baseUrl) {
    Logger.log('❌ VPS_FETCH_TOKEN or VPS_FETCH_BASE not set');
    return;
  }
  
  Logger.log('Base URL: ' + baseUrl);
  Logger.log('Token (first 20 chars): ' + token.substring(0, 20) + '...');
  Logger.log('\n📤 接続テスト中...\n');
  
  // /crawl エンドポイントでテスト
  const testUrl = baseUrl + '/crawl?url=' + encodeURIComponent('https://example.com');
  
  try {
    const response = UrlFetchApp.fetch(testUrl, {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    
    const code = response.getResponseCode();
    const result = response.getContentText();
    
    Logger.log('📥 HTTP Status: ' + code);
    Logger.log('Response (first 500 chars): ' + result.substring(0, 500));
    
    if (code === 200) {
      Logger.log('\n✅ 接続成功！');
    } else if (code === 401) {
      Logger.log('\n⚠️ 認証エラー - VPS_FETCH_TOKENが無効です');
    } else if (code === 403) {
      Logger.log('\n⚠️ アクセス拒否 - VPS_FETCH_TOKENに権限がありません');
    } else {
      Logger.log('\n⚠️ エラー');
    }
    
  } catch (e) {
    Logger.log('\n❌ 接続エラー: ' + e.message);
  }
}

/**
 * 全VPS接続の一括テスト
 */
function testAllVpsConnections() {
  Logger.log('====================================');
  Logger.log('全VPS接続テスト');
  Logger.log('====================================\n');
  
  testVpsOcrConnection();
  Logger.log('\n---\n');
  
  testVpsAsrConnection();
  
  Logger.log('\n====================================');
}
