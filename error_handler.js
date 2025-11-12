/**
 * エラー通知機能
 * 
 * 【機能】
 * - システムエラー発生時に管理者にメール通知
 * - 実行ログへのリンク付き
 */

/* ========================================================================== */
/* エラー通知                                                                 */
/* ========================================================================== */

/**
 * エラー発生時に管理者へメール通知
 * 
 * @param {string} errorMessage - エラーメッセージ
 * @param {string} functionName - エラーが発生した関数名
 * @param {object} details - 追加の詳細情報
 */
function notifyError_(errorMessage, functionName, details = {}) {
  const subject = `[会議通知システム] エラー: ${functionName}`;
  const body = `
エラーが発生しました

━━━━━━━━━━━━━━━━━━
■関数名
${functionName}

■エラーメッセージ
${errorMessage}

■詳細
${JSON.stringify(details, null, 2)}

■発生日時
${new Date().toLocaleString('ja-JP', {timeZone: 'Asia/Tokyo'})}

━━━━━━━━━━━━━━━━━━
ログを確認してください：
https://script.google.com/home/projects/17VmT9onlHGehqRFZDCtvjiNW6ulcHCHyvngQmOzGDt9q1MxC5XuQTBc0/executions
  `;
  
  try {
    GmailApp.sendEmail(
      'toshihiro.higaki@klammer.co.jp',
      subject,
      body
    );
  } catch (e) {
    Logger.log('Failed to send error notification: ' + e.message);
  }
}

/**
 * エラー通知のテスト用関数
 */
function testErrorNotification() {
  notifyError_('これはテストです', 'testFunction', {test: true});
}
