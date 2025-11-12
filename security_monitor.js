/**
 * セキュリティ監視・異常検知機能
 * 
 * 【機能】
 * 1. エラー率の監視
 * 2. 異常アクセスパターンの検知
 * 3. API使用量の監視
 * 4. セキュリティダッシュボード
 * 
 * 【実行】
 * - monitorSecurityStatus() を1時間に1回実行（トリガー設定）
 */

/* ========================================================================== */
/* 1. メインモニタリング関数                                                  */
/* ========================================================================== */

/**
 * セキュリティ状態を定期監視（1時間に1回実行推奨）
 */
function monitorSecurityStatus() {
  Logger.log('=== セキュリティ監視開始 ===\n');
  
  const results = {
    timestamp: new Date().toISOString(),
    checks: []
  };
  
  // 1. エラー率チェック
  const errorRateCheck = checkErrorRate_();
  results.checks.push(errorRateCheck);
  
  // 2. 異常アクセスチェック
  const accessPatternCheck = checkAccessPatterns_();
  results.checks.push(accessPatternCheck);
  
  // 3. API使用量チェック
  const apiUsageCheck = checkApiUsage_();
  results.checks.push(apiUsageCheck);
  
  // 4. VPS接続チェック
  const vpsHealthCheck = checkVpsHealth_();
  results.checks.push(vpsHealthCheck);
  
  // アラートが必要なチェックがあるか確認
  const alerts = results.checks.filter(c => c.alert);
  
  if (alerts.length > 0) {
    Logger.log(`⚠️ ${alerts.length}件のアラートを検出`);
    sendSecurityReport_(results, true);
  } else {
    Logger.log('✅ 異常なし');
  }
  
  // 監視結果を記録
  saveMonitoringResult_(results);
  
  Logger.log('\n=== セキュリティ監視完了 ===');
}

/* ========================================================================== */
/* 2. 個別チェック関数                                                        */
/* ========================================================================== */

/**
 * エラー率をチェック（30%以上でアラート）
 */
function checkErrorRate_() {
  const cache = CacheService.getScriptCache();
  const totalKey = 'monitor_total_requests';
  const errorKey = 'monitor_error_requests';
  
  const total = parseInt(cache.get(totalKey) || '0');
  const errors = parseInt(cache.get(errorKey) || '0');
  
  const errorRate = total > 0 ? (errors / total) * 100 : 0;
  const threshold = 30;  // 30%
  
  return {
    name: 'error_rate',
    value: errorRate.toFixed(2) + '%',
    details: { total, errors },
    alert: errorRate > threshold,
    message: errorRate > threshold 
      ? `エラー率が${threshold}%を超えています` 
      : 'エラー率は正常範囲内'
  };
}

/**
 * 異常なアクセスパターンを検知
 */
function checkAccessPatterns_() {
  const cache = CacheService.getScriptCache();
  const rateLimitKey = 'monitor_rate_limit_hits';
  
  const hits = parseInt(cache.get(rateLimitKey) || '0');
  const threshold = 5;  // 5回以上でアラート
  
  return {
    name: 'access_pattern',
    value: `${hits}件のRate limit`,
    details: { hits },
    alert: hits > threshold,
    message: hits > threshold 
      ? '異常なアクセスパターンを検出' 
      : 'アクセスパターンは正常'
  };
}

/**
 * API使用量をチェック（Gemini API）
 */
function checkApiUsage_() {
  const cache = CacheService.getScriptCache();
  const usageKey = 'monitor_gemini_calls';
  
  const calls = parseInt(cache.get(usageKey) || '0');
  const threshold = 100;  // 1時間に100回でアラート
  
  return {
    name: 'api_usage',
    value: `${calls}回/時`,
    details: { calls },
    alert: calls > threshold,
    message: calls > threshold 
      ? 'API使用量が多すぎます' 
      : 'API使用量は正常範囲内'
  };
}

/**
 * VPS接続状態をチェック
 */
function checkVpsHealth_() {
  try {
    // VPSへの軽量なヘルスチェック
    const testUrl = 'https://www.meti.go.jp/';
    const html = fetchViaVps_(testUrl);
    
    const isHealthy = html && html.length > 100;
    
    return {
      name: 'vps_health',
      value: isHealthy ? '正常' : '異常',
      details: { responseLength: html ? html.length : 0 },
      alert: !isHealthy,
      message: isHealthy ? 'VPS接続は正常' : 'VPS接続に問題があります'
    };
  } catch (e) {
    return {
      name: 'vps_health',
      value: 'エラー',
      details: { error: e.message },
      alert: true,
      message: `VPS接続エラー: ${e.message}`
    };
  }
}

/* ========================================================================== */
/* 3. レポート・記録                                                          */
/* ========================================================================== */

/**
 * セキュリティレポートを送信
 */
function sendSecurityReport_(results, alertOnly = false) {
  const subject = alertOnly 
    ? '[⚠️ アラート] セキュリティ監視レポート'
    : '[情報] セキュリティ監視レポート';
  
  let body = `
セキュリティ監視レポート

━━━━━━━━━━━━━━━━━━
■監視日時
${results.timestamp}

■チェック結果
`;
  
  results.checks.forEach(check => {
    const icon = check.alert ? '⚠️' : '✅';
    body += `\n${icon} ${check.name}: ${check.value}`;
    body += `\n   ${check.message}`;
    if (check.alert && check.details) {
      body += `\n   詳細: ${JSON.stringify(check.details)}`;
    }
    body += '\n';
  });
  
  body += `
━━━━━━━━━━━━━━━━━━
ログを確認してください：
https://script.google.com/home
  `;
  
  try {
    GmailApp.sendEmail(
      'toshihiro.higaki@klammer.co.jp',
      subject,
      body
    );
    Logger.log('✅ セキュリティレポート送信完了');
  } catch (e) {
    Logger.log('❌ レポート送信失敗: ' + e.message);
  }
}

/**
 * 監視結果を記録（ScriptPropertiesに保存）
 */
function saveMonitoringResult_(results) {
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'security_monitor_last_result';
    props.setProperty(key, JSON.stringify(results));
  } catch (e) {
    Logger.log('監視結果の保存失敗: ' + e.message);
  }
}

/* ========================================================================== */
/* 4. カウンター更新関数（各機能から呼び出される）                            */
/* ========================================================================== */

/**
 * リクエストカウンターを更新
 */
function incrementRequestCounter_(success = true) {
  const cache = CacheService.getScriptCache();
  
  const totalKey = 'monitor_total_requests';
  const total = parseInt(cache.get(totalKey) || '0');
  cache.put(totalKey, String(total + 1), 3600);
  
  if (!success) {
    const errorKey = 'monitor_error_requests';
    const errors = parseInt(cache.get(errorKey) || '0');
    cache.put(errorKey, String(errors + 1), 3600);
  }
}

/**
 * Rate limitヒットカウンターを更新
 */
function incrementRateLimitCounter_() {
  const cache = CacheService.getScriptCache();
  const key = 'monitor_rate_limit_hits';
  const hits = parseInt(cache.get(key) || '0');
  cache.put(key, String(hits + 1), 3600);
}

/**
 * Gemini API使用カウンターを更新
 */
function incrementGeminiCounter_() {
  const cache = CacheService.getScriptCache();
  const key = 'monitor_gemini_calls';
  const calls = parseInt(cache.get(key) || '0');
  cache.put(key, String(calls + 1), 3600);
}

/* ========================================================================== */
/* 5. セキュリティダッシュボード                                              */
/* ========================================================================== */

/**
 * セキュリティダッシュボード（現在の状態を表示）
 */
function showSecurityDashboard() {
  Logger.log('=== セキュリティダッシュボード ===\n');
  
  const cache = CacheService.getScriptCache();
  
  // リクエスト統計
  const total = parseInt(cache.get('monitor_total_requests') || '0');
  const errors = parseInt(cache.get('monitor_error_requests') || '0');
  const errorRate = total > 0 ? ((errors / total) * 100).toFixed(2) : 0;
  
  Logger.log('📊 リクエスト統計（過去1時間）');
  Logger.log(`  総リクエスト数: ${total}`);
  Logger.log(`  エラー数: ${errors}`);
  Logger.log(`  エラー率: ${errorRate}%`);
  Logger.log('');
  
  // Rate limit統計
  const rateLimitHits = parseInt(cache.get('monitor_rate_limit_hits') || '0');
  Logger.log('🚦 Rate Limit統計（過去1時間）');
  Logger.log(`  制限ヒット数: ${rateLimitHits}`);
  Logger.log('');
  
  // API使用量
  const geminiCalls = parseInt(cache.get('monitor_gemini_calls') || '0');
  Logger.log('🤖 API使用量（過去1時間）');
  Logger.log(`  Gemini API呼び出し: ${geminiCalls}回`);
  Logger.log('');
  
  // 最後の監視結果
  const props = PropertiesService.getScriptProperties();
  const lastResult = props.getProperty('security_monitor_last_result');
  
  if (lastResult) {
    const result = JSON.parse(lastResult);
    Logger.log('📅 最終監視');
    Logger.log(`  日時: ${result.timestamp}`);
    
    const alerts = result.checks.filter(c => c.alert);
    if (alerts.length > 0) {
      Logger.log(`  ⚠️ アラート: ${alerts.length}件`);
      alerts.forEach(a => Logger.log(`    - ${a.name}: ${a.message}`));
    } else {
      Logger.log('  ✅ 異常なし');
    }
  }
  
  Logger.log('\n=================================');
}

/**
 * セキュリティ監視のトリガー設定（初回のみ手動実行）
 */
function setupSecurityMonitorTrigger() {
  // 既存のトリガーを削除
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'monitorSecurityStatus') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // 1時間ごとに実行
  ScriptApp.newTrigger('monitorSecurityStatus')
    .timeBased()
    .everyHours(1)
    .create();
  
  Logger.log('✅ セキュリティ監視トリガー設定完了（1時間ごと）');
}