/**
 * Webアプリケーション（購読管理・VPS連携）
 * 
 * 【機能】
 * 1. doGet: 購読管理（配信停止・再登録）、監視対象会議の公開ページ
 * 2. doPost: VPSからのメール送信依頼を受付
 * 
 * 【エンドポイント】
 * - ?page=sources → 監視対象会議一覧ページ
 * - ?action=unsubscribe → 配信停止
 * - ?action=resub → 再登録
 * - POST: action=sendMail → VPSからのメール送信依頼
 */

/* ========================================================================== */
/* 1. Webアプリエントリポイント                                               */
/* ========================================================================== */

/**
 * GETリクエスト処理（購読管理・公開ページ）
 */
function doGet(e) {
  const p = e.parameter;
  
  // 監視対象会議一覧の公開ページ
  if (p.page === 'sources') {
    return showPublicSources_();
  }
  
  // 購読管理（配信停止・再登録）
  const action = (p.action || '').toLowerCase();
  const email = (p.email || '').trim().toLowerCase();
  const token = (p.token || '').trim();
  const source = (p.source || '').trim();

  // Rate limit チェック
  if (email && action) {
    if (!checkRateLimit_(email, action)) {
      Logger.log(`⚠️ Rate limit exceeded: ${email} ${action}`);
      return HtmlService.createHtmlOutput(`
        <div style="font-family: sans-serif; padding: 40px; text-align: center;">
          <h2>⚠️ アクセス制限</h2>
          <p>アクセスが多すぎます。1時間後に再度お試しください。</p>
        </div>
      `);
    }
  }

  if (!email || !token || hmacToken_(email) !== token) {
    return HtmlService.createHtmlOutput('<p>リンクが無効です。</p>');
  }
  
  const sh = ensureRecipientsSheet_();
  const last = sh.getLastRow();
  const rows = last > 1 ? sh.getRange(2, 1, last - 1, 7).getValues() : [];
  const idx = rows.findIndex(r => String(r[0]).trim().toLowerCase() === email);
  
  if (idx < 0) {
    return HtmlService.createHtmlOutput('<p>登録が見つかりません。</p>');
  }

  const row = rows[idx];
  const now = new Date();

  if (action === 'unsubscribe') {
    row[1] = 'unsubscribed';
    row[5] = now;
    sh.getRange(idx + 2, 1, 1, 7).setValues([row]);
    // 配信停止の場合
    // ログ記録
    logSecurityEvent_('unsubscribe', email, 'success');

    // 再登録の場合
    // ログ記録
    logSecurityEvent_('resub', email, 'success');
    return HtmlService.createHtmlOutput('<p>配信を停止しました。再登録はメールのリンクから行えます。</p>');
  } else if (action === 'resub') {
    row[1] = 'active';
    row[5] = now;
    sh.getRange(idx + 2, 1, 1, 7).setValues([row]);
    return HtmlService.createHtmlOutput('<p>配信を再開しました。</p>');
  } else {
    return HtmlService.createHtmlOutput('<p>OK</p>');
  }
}

/**
 * POSTリクエスト処理（VPSからのメール送信依頼）
 */
function doPost(e) {
  Logger.log('=== doPost called ===');
  Logger.log('Received data: ' + e.postData.contents);
  
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    // VPSからのメール送信依頼
    if (action === 'sendMail') {
      Logger.log('📧 VPSからメール送信依頼を受信');
      
      const src = data.sourceData;
      const mt = data.meetingData;
      const summary = data.summary || "";
      const transcriptSource = data.transcriptSource || "なし";
      const agendaPdfUrl = data.agendaPdfUrl || "";
      const rosterPdfUrl = data.rosterPdfUrl || "";
      
      Logger.log(`会議: ${mt.title}`);
      Logger.log(`要約: ${summary.length}文字`);
      Logger.log(`字幕: ${data.transcriptLength || 0}文字`);
      
      // 品質チェック
      if (!summary || summary.length < 500) {
        Logger.log('⚠️ 要約が短すぎるためスキップ');
        return ContentService.createTextOutput(JSON.stringify({ 
          status: 'skipped', 
          reason: 'summary too short' 
        }))
        .setMimeType(ContentService.MimeType.JSON);
      }
      
      // リンクブロック生成
      let links = `■リンク\n・会議ページ: ${mt.pageUrl}\n`;
      if (mt.youtubeUrl) {
        links += `・YouTube: ${mt.youtubeUrl}\n`;
      }
      if (agendaPdfUrl) {
        links += `・議事次第: ${agendaPdfUrl}\n`;
      }
      if (rosterPdfUrl) {
        links += `・委員名簿: ${rosterPdfUrl}\n`;
      }
      
      // メール作成
      const subject = `[${src.name}] ${mt.title}`;
      const plainBody = `${summary}\n\n${links}\n\n────────────────────────────\n字幕ソース: ${transcriptSource}\n\n© Klammer Inc.`;
      
      // 購読者取得
      const recipients = getRecipientsForSource_(src.name);
      
      if (!recipients || recipients.length === 0) {
        Logger.log('⚠️ 購読者なし');
        return ContentService.createTextOutput(JSON.stringify({ 
          status: 'skipped', 
          reason: 'no recipients' 
        }))
        .setMimeType(ContentService.MimeType.JSON);
      }
      
      Logger.log(`📧 送信先: ${recipients.length}名`);
      
      // メール送信
      recipients.forEach(r => {
        const unsubUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?action=unsubscribe&token=${encodeURIComponent(r.token)}&email=${encodeURIComponent(r.email)}&source=${encodeURIComponent(src.name)}`;
        const resubUrl = `${CONFIG.APP.BASE_WEBAPP_URL}?action=resub&token=${encodeURIComponent(r.token)}&email=${encodeURIComponent(r.email)}&source=${encodeURIComponent(src.name)}`;
        const footer = `\n────────────────────────────\n配信停止: ${unsubUrl}\n再登録: ${resubUrl}\n\n© Klammer Inc.`;
        
        const plainPerUser = plainBody + footer;
        
        GmailApp.sendEmail(r.email, subject, plainPerUser);
      });
      
      Logger.log('✅ メール送信完了');
      
      return ContentService.createTextOutput(JSON.stringify({ 
        status: 'sent',
        recipients: recipients.length
      }))
      .setMimeType(ContentService.MimeType.JSON);
    }
    
    // その他のアクション
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (e) {
    Logger.log('doPost error: ' + e.message);
    return ContentService.createTextOutput(JSON.stringify({ error: e.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ========================================================================== */
/* 2. 公開ページ表示                                                          */
/* ========================================================================== */

/**
 * 監視対象会議の公開ページを表示
 */
function showPublicSources_() {
  try {
    const sources = getSources_();
    
    let html = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>監視対象会議一覧 | Klammer Meeting Monitor</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 1000px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 40px 30px;
      text-align: center;
    }
    
    .header h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 10px;
    }
    
    .header p {
      font-size: 14px;
      opacity: 0.9;
    }
    
    .content {
      padding: 30px;
    }
    
    .stats {
      display: flex;
      justify-content: space-around;
      margin-bottom: 30px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    
    .stat-item {
      text-align: center;
    }
    
    .stat-number {
      font-size: 32px;
      font-weight: 700;
      color: #667eea;
      display: block;
    }
    
    .stat-label {
      font-size: 14px;
      color: #6c757d;
      margin-top: 5px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    
    thead {
      background: #f8f9fa;
    }
    
    th {
      padding: 15px;
      text-align: left;
      font-weight: 600;
      color: #495057;
      font-size: 14px;
      border-bottom: 2px solid #dee2e6;
    }
    
    td {
      padding: 15px;
      border-bottom: 1px solid #dee2e6;
      font-size: 14px;
    }
    
    tbody tr:hover {
      background: #f8f9fa;
    }
    
    .agency-badge {
      display: inline-block;
      padding: 4px 12px;
      background: #e7f3ff;
      color: #0066cc;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }
    
    .link-button {
      display: inline-block;
      padding: 8px 16px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-size: 13px;
      transition: background 0.2s;
    }
    
    .link-button:hover {
      background: #5568d3;
    }
    
    .footer {
      padding: 20px 30px;
      text-align: center;
      background: #f8f9fa;
      color: #6c757d;
      font-size: 13px;
      border-top: 1px solid #dee2e6;
    }
    
    @media (max-width: 768px) {
      .stats {
        flex-direction: column;
        gap: 20px;
      }
      
      table {
        font-size: 12px;
      }
      
      th, td {
        padding: 10px;
      }
      
      .header h1 {
        font-size: 22px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>監視対象会議一覧</h1>
      <p>政府の検討会・審議会を自動監視し、要約を配信しています</p>
    </div>
    
    <div class="content">
      <div class="stats">
        <div class="stat-item">
          <span class="stat-number">${sources.length}</span>
          <span class="stat-label">監視中の会議</span>
        </div>
        <div class="stat-item">
          <span class="stat-number">毎日</span>
          <span class="stat-label">自動チェック</span>
        </div>
        <div class="stat-item">
          <span class="stat-number">AI要約</span>
          <span class="stat-label">Gemini 2.5</span>
        </div>
      </div>
      
      <table>
        <thead>
          <tr>
            <th style="width: 15%;">省庁</th>
            <th style="width: 50%;">会議名</th>
            <th style="width: 35%;">リンク</th>
          </tr>
        </thead>
        <tbody>
    `;
    
    sources.forEach(src => {
      html += `
          <tr>
            <td><span class="agency-badge">${src.agency || '経済産業省'}</span></td>
            <td><strong>${src.name}</strong></td>
            <td><a href="${src.indexUrl}" target="_blank" class="link-button">会議ページ →</a></td>
          </tr>
      `;
    });
    
    const updateTime = new Date().toLocaleString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    html += `
        </tbody>
      </table>
    </div>
    
    <div class="footer">
      <p>最終更新: ${updateTime}</p>
      <p style="margin-top: 10px;">© 2025 Klammer Inc. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;
    
    return HtmlService.createHtmlOutput(html)
      .setTitle('監視対象会議一覧')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      
  } catch (e) {
    return HtmlService.createHtmlOutput(`
      <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <h2>エラーが発生しました</h2>
          <p>${e.message}</p>
        </body>
      </html>
    `);
  }
}

/* ========================================================================== */
/* 3. 補助関数                                                                */
/* ========================================================================== */

/**
 * HMACトークン生成
 */
function hmacToken_(email) {
  const em = String(email || '').trim().toLowerCase();
  const sig = Utilities.computeHmacSha256Signature(em, CONFIG.APP.SECRET);
  const b64 = Utilities.base64Encode(sig).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64;
}

/**
 * 購読者シート取得（シートが存在しない場合は自動作成）
 */
function ensureRecipientsSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.RECIPIENTS.SHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.RECIPIENTS.SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.RECIPIENTS.SHEET_NAME);
    sheet.getRange('A1:D1').setValues([['email', 'status', 'sources', 'token']]);
  }
  
  return sheet;
}

/* ========================================================================== */
/* 4. セキュリティ機能                                                        */
/* ========================================================================== */

/**
 * Rate limiting（アクセス頻度制限）
 */
function checkRateLimit_(email, action) {
  if (!email || !action) return true;
  
  const cache = CacheService.getScriptCache();
  const key = `rate_${email}_${action}`;
  const count = parseInt(cache.get(key) || '0');
  
  // 制限: 10回/時間
  if (count >= 10) {
    // 異常なアクセスとして記録
    logSecurityEvent_(action, email, 'rate_limit_exceeded', { count: count + 1 });
    return false;
  }
  
  cache.put(key, String(count + 1), 3600);  // 1時間
  return true;
}

/**
 * セキュリティイベントのログ記録
 */
function logSecurityEvent_(action, email, status, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    action,
    email: email || 'unknown',
    status,
    details: JSON.stringify(details)
  };
  
  Logger.log(`[SECURITY] ${timestamp} | ${action} | ${email} | ${status}`);
  
  // 異常なケースは管理者に通知
  if (status === 'rate_limit_exceeded' || status === 'invalid_token' || status === 'suspicious_activity') {
    notifySecurityAlert_(logEntry);
  }
}

/**
 * セキュリティアラートを管理者に通知
 */
function notifySecurityAlert_(logEntry) {
  // 短時間に複数のアラートが来ないようにキャッシュでチェック
  const cache = CacheService.getScriptCache();
  const cacheKey = `alert_sent_${logEntry.email}_${logEntry.action}`;
  
  if (cache.get(cacheKey)) {
    return;  // 既に通知済み
  }
  
  try {
    const subject = `[セキュリティアラート] ${logEntry.status}`;
    const body = `
セキュリティイベントが検出されました

━━━━━━━━━━━━━━━━━━
■発生日時
${logEntry.timestamp}

■アクション
${logEntry.action}

■ユーザー
${logEntry.email}

■ステータス
${logEntry.status}

■詳細
${logEntry.details}

━━━━━━━━━━━━━━━━━━
ログを確認してください：
https://script.google.com/home/projects/17VmT9onlHGehqRFZDCtvjiNW6ulcHCHyvngQmOzGDt9q1MxC5XuQTBc0/executions
    `;
    
    GmailApp.sendEmail(
      'toshihiro.higaki@klammer.co.jp',
      subject,
      body
    );
    
    // 1時間は同じアラートを送らない
    cache.put(cacheKey, '1', 3600);
  } catch (e) {
    Logger.log(`Failed to send security alert: ${e.message}`);
  }
}

/**
 * 入力値の検証（XSS対策）
 */
function validateInput_(input) {
  if (!input) return true;
  
  // 危険な文字列パターン
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,  // onclick=, onload= など
    /<iframe/i,
    /eval\(/i,
    /expression\(/i
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(input)) {
      logSecurityEvent_('input_validation', 'unknown', 'suspicious_input', { input });
      return false;
    }
  }
  
  return true;
}