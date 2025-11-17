# 政府会議ウォッチャー - システム設計書

経済産業省・金融庁の政府会議を自動監視し、AIで要約してメール配信するシステム

**最終更新**: 2025-11-17  ← 変更
**バージョン**: 0.6.0  ← 変更
**監視会議数**: 18会議（経産省12 + 金融庁6）
**稼働状況**: β版稼働中（購読管理システム実装済み）  ← 変更
---

## 📊 システム概要

### ビジョン
政府会議の情報を民主化し、政策決定プロセスの透明性を高める

### 主要機能
- ✅ 14会議の自動監視（毎日09:00 JST）
- ✅ 新着会議の自動検知
- ✅ PDF OCR処理（VPS上でPyMuPDF）
- ✅ YouTube字幕取得（yt-dlp）
- ✅ Gemini 2.5 Flashによる要約
- ✅ 購読者へのメール配信
- ✅ Archive機能（送信済み会議の管理）
- ✅ セキュリティ監視（fail2ban）

### システム構成
```
┌─────────────────────────────────────┐
│         Google Apps Script          │
│   - メール配信                        │
│   - スケジュール実行                   │
│   - 会議情報の解析                    │
└──────────┬──────────────────────────┘
           │ HTTPS
           ↓
┌─────────────────────────────────────┐
│  Nginx (fetch.klammer.co.jp)        │
│   - リバースプロキシ                  │
│   - SSL終端                          │
│   - Basic認証（計画中）               │
└──────────┬──────────────────────────┘
           │
     ┌─────┴─────┐
     ↓           ↓
┌─────────┐  ┌─────────┐
│fetcher  │  │  asr    │
│:3000    │  │  :8080  │
│Node.js  │  │ Python  │
│PM2      │  │ Docker  │
└─────────┘  └─────────┘
  ↓              ↓
Webページ    YouTube字幕
取得          PDF OCR
           
           ↓
┌─────────────────────────────────────┐
│         Google Gemini API           │
│   - gemini-2.5-flash (要約生成)      │
└─────────────────────────────────────┘
```
### システムフロー（省庁別）

#### 経産省会議
```
1. 会議ページ検知（dailyCheckAll）
2. YouTube字幕取得（VPS/yt-dlp）
3. 議事次第PDF取得（VPS/OCR）
4. 議題抽出（PDF OCR → フォールバック）
5. Gemini APIで要約生成
6. メール配信（即時）
7. Archiveに保存（phase='summary'）
```

#### 金融庁会議
```
【フェーズ1: 資料公開時】
1. 会議ページ検知（dailyCheckAll）
2. 資料ページから議題抽出（HTML <dl> 構造）
3. 配布資料リンクを含めて通知
4. Archiveに保存（phase='resources'）

【フェーズ2: 議事録公開時（1-2ヶ月後）】
1. 議事録URLの公開を検知（定期チェック）
2. 議事録HTML取得
3. Gemini APIで要約生成
4. メール配信（要約あり）
5. Archiveを更新（phase='summary'）
```

### 技術スタック
- **GAS**: メインロジック、メール配信
- **Node.js (fetcher)**: Webスクレイピング
- **Python (asr)**: OCR、字幕取得
  - yt-dlp==2025.11.12 ⚠️ バージョン固定
  - Deno 2.5.6 ⚠️ PO Token生成に必須
  - faster-whisper==1.1.0
  - PyMuPDF (OCR)
- **Nginx**: リバースプロキシ、SSL
- **Gemini API**: AI要約
- **VPS**: Ubuntu 24.04

### 依存関係管理

⚠️ **外部API依存の重要性**

YouTube、Gemini APIなど外部サービスは予告なく仕様変更される可能性があります。

**対策**:
1. **バージョン固定**: requirements.txt で明示的に指定
2. **定期チェック**: 月1回、依存ライブラリのリリースノートを確認
3. **監視強化**: エラーの詳細を常に記録
4. **デバッグモード**: 環境変数で切り替え可能

#### requirements.txt（例）
```txt
yt-dlp==2025.11.12  # ← 固定
faster-whisper==1.1.0
google-generativeai==0.8.3
PyMuPDF==1.23.8
```

#### 定期アップデート手順
```bash
# 月1回実施
# 1. リリースノート確認
# https://github.com/yt-dlp/yt-dlp/releases

# 2. コンテナ内でアップデート
docker exec -it asr_asr_1 pip install -U yt-dlp --break-system-packages

# 3. テスト実行
curl -X POST https://fetch.klammer.co.jp/asr/youtube-subs \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"url":"test-url"}'

# 4. 問題なければ requirements.txt 更新
# 5. 再ビルド
docker-compose up --build -d
```
### 最近の更新
#### 2025-11-17: 購読管理システム実装 ✅
- ✅ 購読者へのメール送信機能の修正
  - `getRecipientsForSource_`関数の修正（ID対応）
  - 購読者取得ロジックの改善
- ✅ archiveシート構造の修正
  - `sent_at`列の削除
  - phase列の命名改善提案（`awaiting_minutes` / `completed`）
  - `gijirokuUrl`の正しい保存実装
- ✅ 議事録監視機能の動作確認
  - `checkFsaGijiyoshi_`関数の動作確認
  - phase='awaiting_minutes'会議の自動検知テスト
- 🔧 VPS側PDF取得エラーの診断（未解決）
  - HTTP 401エラーの継続
  - ヘッダー追加による修正を試行中

#### 2025-11-16: 会議管理システム実装 ✅
- ✅ 複合ID形式（METI_001形式）への移行
- ✅ meeting-manager.gs による会議追加・管理の自動化
- ✅ 監視会議を14→18に拡大
  - 次世代電力系統WG（スマートパワーグリッド）
  - 再生可能エネルギー大量導入・次世代電力ネットワーク小委員会
  - 電力・ガス基本政策小委員会
  - 原子力小委員会
- ✅ 公開Webページ実装（監視会議一覧・検索機能付き）
  
#### 2025-11-14: Phase 2-3完了 ✅

**金融庁6会議の完全対応**:
- ✅ 資料公開通知の自動化（議題付き）
- ✅ 議事録監視機能の実装
- ✅ 全6会議で議題抽出成功（6/6）
- ✅ Archive完全対応（phase管理）

**優先度1-3の完全達成**:
1. ✅ 日付表示の修正
   - state保存の改善
   - 令和表記から西暦への変換
   - レポートでの正確な日付表示
2. ✅ 最新会議の選択修正
   - 日付ソートの実装
   - 令和7年度会議の正確な抽出
3. ✅ 議題抽出の改善
   - HTML構造の分析（`<dl class="l_material">`対応）
   - 複数パターンの実装
   - 暗号資産制度WGの特殊構造対応
   - **全6会議で議題抽出成功**

**追加改善**:
- ✅ 表形式レポートの実装（HTML、色分け）
- ✅ 機関名の追加（経産省/金融庁の区別）
- ✅ エラーハンドリングの強化
#### 2025-11-13: YouTube PO Token対応完了 ⚠️ 重要

**背景**:
- YouTube側のPO Token認証導入により、全14会議で字幕取得が失敗
- yt-dlp 2025.10.22では対応不可能と判明
- 約4時間でVPS復旧完了

**対応内容**:
1. yt-dlpを2025.10.22 → 2025.11.12にアップデート
2. Deno 2.5.6をインストール（PO Token自動生成に必要）
3. ydl_opts設定をシンプル化（最新版は自動で最適化）
4. cookieファイル検証

**根本原因**:
- YouTube側（60%）: 予期せぬPO Token要件の展開
- システム側（40%）: 
  - バージョン固定不足
  - エラー監視・通知体制不足
  - デバッグモード未整備

**再発防止策**:
- 依存関係のバージョン固定（requirements.txt）
- 月次の依存ライブラリチェック
- エラーログの詳細記録
- DEBUG_MODE環境変数の追加

**参考資料**:
- [Perplexity調査結果](内部資料)
- [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)

---

#### 2025-11-13: VPS復旧完了（セキュリティインシデント）
- サイバー攻撃からの復旧
- fail2ban によるブロック機能確認
- Nginx設定修正（port 3000へ）

#### 2025-11-12: 監視会議拡大
- 11会議 → 14会議（経産省8 + 金融庁6）
- 2025-11-13: **VPS復旧完了**（サイバー攻撃からの復旧）
- 2025-11-13: Nginx設定修正（port 3000へ）
- 2025-11-12: 監視会議を11→14に拡大

---

## ⚠️ 重要な注意事項

### YouTube字幕取得について

**重要**: YouTubeは2025年10月以降、PO Token（Proof of Origin）認証を段階的に導入しており、字幕取得には以下の要件が**必須**です：

#### 必須要件
1. **yt-dlp 2025.11.12以降**
2. **Deno 2.5.6以降**（JavaScriptランタイム）
3. **有効なcookieファイル**（YouTube認証用）

これらが揃っていない場合、以下のエラーが発生します：
- `No video formats found!`
- `Requested format is not available`
- `Sign in to confirm you're not a bot`

#### 対応の背景（2025-11-13）

**事象**:
- 14会議すべてで字幕取得が突然失敗
- YouTube側のPO Token要件により、既存の yt-dlp 2025.10.22 では対応不可

**対応内容**:
1. yt-dlpを2025.11.12にアップデート
2. Denoをインストール（PO Token自動生成に必要）
3. シンプルな設定に変更（最新版は自動最適化）

**教訓**:
- 外部API依存は必ず壊れる前提で設計する
- 依存関係のバージョンを固定し、定期的にチェックする
- エラーの詳細ログを常に記録する（本番環境でも）
- デバッグモードを環境変数で切り替え可能にする

#### 参考資料
- [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
- [Issue #13075](https://github.com/yt-dlp/yt-dlp/issues/13075)
- [PR #13234](https://github.com/yt-dlp/yt-dlp/pull/13234)

---


## 🏛️ 監視対象会議

### 経済産業省（8会議）

#### 会議の構造
```
会議トップページ (XXX.html)
└─ 会議ページ (001.html, 002.html, ...)
   ├─ PDF（議事次第、委員名簿、資料1-N、参考資料1-N）
   └─ YouTube動画（配信された場合）
```

#### URL形式
- インデックス: `https://www.meti.go.jp/shingikai/.../XXX.html`
- 会議ページ: `https://www.meti.go.jp/shingikai/.../001.html`
- ID形式: 連番（1, 2, 3, ...）

#### 対象会議一覧
1. [METI_001] 同時市場の在り方等に関する検討会
2. [METI_002] 電力システム改革の検証を踏まえた制度設計WG
3. [METI_003] 排出量取引制度小委員会
4. [METI_004] 製造業ベンチマーク検討WG
5. [METI_005] 発電ベンチマーク検討WG
6. [METI_006] GX推進のためのグリーン鉄研究会
7. [METI_007] 次世代の分散型電力システムに関する検討会
8. [METI_008] GXリーグにおけるサプライチェーンでの取組のあり方に関する研究会
9. [METI_009] 次世代電力系統WG（スマートパワーグリッド）  ← 新規
10. [METI_010] 再生可能エネルギー大量導入・次世代電力ネットワーク小委員会  ← 新規
11. [METI_011] 電力・ガス基本政策小委員会  ← 新規
12. [METI_012] 原子力小委員会  ← 新規

### 金融庁（6会議）

#### 会議の構造
```
会議トップページ (XXX_index.html)
├─ 第5回 2025年11月7日
│  ├─ 開催通知 (news/r7/singi/20251031.html)
│  ├─ 資料ページ (gijishidai/20251107.html) ← 当日公開
│  └─ 議事録ページ (gijiroku/20251107.html) ← 1-2ヶ月後（未公開の場合あり）
├─ 第4回 2025年10月22日
│  ├─ 開催通知
│  ├─ 資料ページ
│  └─ （議事録未公開）
└─ 第3回 2025年9月29日
   ├─ 開催通知
   ├─ 資料ページ
   └─ 議事録ページ ← 公開済み
```

#### HTML構造の特徴

**会議一覧（トップページ）**:
```html
<ul class="fsc_list no_icon">
  <li><p>第５回 令和７年11月７日（金曜）</p>
   <ul>
    <li><a href="/news/...">開催通知</a></li>
    <li><a href="/singi/.../gijishidai/20251107.html">資料</a></li>
    <!-- 議事録は公開後に追加 -->
   </ul>
  </li>
  <li><p>第３回 令和７年９月29日（月曜）</p>
   <ul>
    <li><a href="/news/...">開催通知</a></li>
    <li><a href="/singi/.../gijishidai/20250929.html">資料</a></li>
    <li><a href="/singi/.../gijiroku/20250929.html">議事録</a></li>
   </ul>
  </li>
</ul>
```

**重要**: 
- ❌ `<table><tr>` 構造ではない
- ✅ `<ul><li>` 構造を使用
- ✅ 議事録リンクは公開後に追加される

---

**配付資料（資料ページ）**:
```html
<h2>配付資料</h2>
<dl class="l_material char3 mt20">
  <dt>資料１</dt>
  <dd>
    <img alt="PDF" class="pdf" src="...">
    <a href="...">事務局説明資料①</a>
  </dd>
  <dt>資料２</dt>
  <dd>
    <img alt="PDF" class="pdf" src="...">
    <a href="...">事務局説明資料②</a>
  </dd>
</dl>
```

**重要**: 
- ❌ 「議題」という見出しは**存在しない**
- ❌ `<ol>` や `<ul>` ではない
- ✅ `<dl>` (Definition List) を使用
- ✅ 配付資料リストから議題を推測

---

#### URL形式
- インデックス: `https://www.fsa.go.jp/singi/.../XXX_index.html`
- 資料ページ: `https://www.fsa.go.jp/singi/.../gijishidai/YYYYMMDD.html`
- 議事録ページ: `https://www.fsa.go.jp/singi/.../gijiroku/YYYYMMDD.html`
- ID形式: 回数（第1回、第2回...）

#### 議題の抽出方法 ✅ 実装完了

1. 資料ページのHTMLを取得
2. HTML全体から`<dt>資料X</dt><dd>...</dd>`パターンを検索
3. 各資料のタイトルを議題として使用

**実装の特徴**:
- ✅ 複数の`<dl class="l_material">`に対応（会議概要と資料リストの分離）
- ✅ HTML全体を検索（特定の`<dl>`に依存しない）
- ✅ フォールバックパターンで高い成功率

**例**:
```html
<dt>資料１</dt><dd>事務局説明資料①</dd>
<dt>資料２</dt><dd>事務局説明資料②</dd>

↓ 抽出結果

1. 事務局説明資料①
2. 事務局説明資料②
```

**抽出成功率**: 6/6会議（100%）
```

#### 対象会議一覧
9. [FSA_001] AI官民フォーラム
10. [FSA_002] 暗号資産制度WG
11. [FSA_003] サステナビリティ開示WG
12. [FSA_004] 市場制度ワーキング・グループ
13. [FSA_005] ディスクロージャーワーキング・グループ
14. [FSA_006] コーポレートガバナンス・コードの改訂に関する有識者会議
---

## 🔧 主要コンポーネント

### 1. 会議監視・検知

#### `dailyCheckAll()`
- **実行**: 毎日09:00 JST（時間トリガー）
- **処理フロー**:
  1. sourcesシートから監視対象を読み込み
  2. 各会議のインデックスページを取得
  3. 会議ページ一覧を抽出
  4. stateと比較して新着を検知
  5. 新着があれば処理・配信
  6. 管理者にレポート送信

#### 省庁別の処理分岐
```javascript
// 経産省
if (src.agency === '経済産業省' || src.agency === '資源エネルギー庁') {
  pages = extractMeetingPages_(html, baseDir);
  mt = scrapeMeetingPage_(url);
}

// 金融庁
else if (src.agency === '金融庁') {
  pages = extractFsaMeetingPages_(html, baseDir);
  mt = scrapeFsaMeetingPage_(url);
}
```

### 2. コンテンツ処理

#### `processMeeting_(mt, srcId)`
```
1. YouTube字幕取得（VPS/asr）
2. PDF OCR処理（VPS/asr）
3. コンテンツ統合
4. Gemini API で要約生成
5. メール本文作成
6. 購読者に配信
7. Archiveに保存
```

#### VPS連携

**HTML取得**: `fetchViaVps_()` → fetcher (port 3000)
```javascript
const fetcherUrl = CONFIG.SUBS.BASE_URL + '/fetcher/crawl?url=' + encodeURIComponent(url);
const res = UrlFetchApp.fetch(fetcherUrl, {
  headers: { 'Authorization': 'Bearer ' + CONFIG.SUBS.TOKEN }
});
```

**PDF処理**: `/ocr` → asr (port 8080)
- PyMuPDF でテキスト抽出
- OCR処理（画像PDF対応）

**YouTube処理**: `/transcript` → asr (port 8080)
- yt-dlp で字幕取得
- 自動生成字幕対応

### 3. 実装済み関数一覧

#### Phase 1: 基盤整備
- ✅ `upgradeArchiveSheet()` - archiveシート拡張（新列追加）
- ✅ `toAbsUrl_(url, baseUrl)` - 相対URL → 絶対URL変換
- ✅ `toDir_(url)` - URLのディレクトリ部分を取得

#### Phase 2: 金融庁専用処理
- ✅ `extractFsaMeetingPages_(html, baseDir)` - 会議一覧抽出（ul/li対応、日付ソート）
- ✅ `extractAgendaFromFsaResourcePage_(html)` - 議題抽出（dl構造対応、複数パターン）
- ✅ `scrapeFsaMeetingPage_(url)` - 資料/議事録ページ解析
- ✅ `findInArchive_(sourceId, meetingId)` - archive検索
- ✅ `updateArchive_(rowIndex, updates)` - archive更新
- ✅ `saveToArchive_(..., phase)` - phase対応版
- ✅ `sendFsaResourceNotification_(src, meeting)` - 資料公開通知
- ✅ `sendFsaSummaryNotification_(src, meeting)` - 議事録公開通知
- ✅ `summarizeMeeting_(..., providedAgenda)` - 外部議題対応

#### Phase 3: 統合 ✅
- ✅ `checkFsaMeeting_(src, state)` - 金融庁会議チェック（dailyCheckAll統合済み）
- ✅ `checkFsaGijiyoshi_()` - 議事録監視（定期チェック実装済み）
- ✅ `dailyCheckAll()` 修正 - 金融庁完全対応、表形式レポート

#### 経産省関連（改善済み）
- ✅ `fallbackAgendaFromTitleOrPdfs_(mt)` - PDFタイトルから議題生成（修正済み）

#### レポート関連（新規）
- ✅ `sendDailyCheckReport_(summary, startTime, endTime)` - HTML表形式レポート

### 3. 要約生成

#### Gemini API設定
```javascript
model: "gemini-2.5-flash"
temperature: 0.3
maxOutputTokens: 4096
```

#### プロンプト構造
```
あなたは政府会議の専門記者です。
以下の会議内容を、ビジネスパーソン向けに要約してください。

【会議情報】
タイトル: ...
開催日: ...

【資料内容】
...

【YouTube字幕】
...

【要約の観点】
1. 会議の目的
2. 主な論点
3. 重要な決定事項
4. 今後の予定
```

### 4. 購読者管理

#### recipients シート
| email | name | sources | active |
|-------|------|---------|--------|
| user@example.com | 山田太郎 | 1,2,3 | TRUE |

- `sources`: 購読する会議ID（カンマ区切り）
- 空欄 or "all" = 全会議購読

### 5. データ管理

#### state スクリプトプロパティ
```json
{
  "https://www.meti.go.jp/shingikai/.../XXX.html": {
    "lastId": 20,
    "lastUrl": "https://www.meti.go.jp/.../020.html",
    "lastMeetingDate": "2025年9月22日",
    "lastCheckedAt": "2025-11-13T00:00:00.000Z",
    "pendingSummary": null
  }
}
```
### 6. 購読管理システム

#### 購読者取得ロジック
```javascript
function getRecipientsForSource_(sourceIdOrName) {
  // ID形式（METI_002）または会議名で検索
  // ID形式の場合は正規化せず直接比較
  // 会議名の場合は正規化して比較
}
```

#### recipientsシート構造
| email | status | sources | token | created_at | updated_at | note |
|-------|--------|---------|-------|------------|------------|------|
| user@example.com | active | METI_001,METI_002 | xxx | ... | ... | |

- `status`: active / unsubscribed
- `sources`: 購読会議ID（カンマ区切り）または `*`（全会議）
- `token`: 配信停止用トークン


#### archive シート（拡張版）

| 列名 | 説明 | 例 |
|------|------|-----|
| id | 連番 | 1 |
| sourceId | ソースID | 10 |
| sourceName | 会議名 | 暗号資産制度WG |
| agency | 省庁 | 金融庁 |
| meetingId | 会議回数 | 5 |
| meetingDate | 開催日 | 2025-11-07 |
| title | 会議タイトル | 金融審議会「暗号資産制度...」 |
| url | 会議URL | https://... |
| youtube | YouTubeURL | https://... |
| agendaPdfUrl | 議事次第PDF | https://... |
| rosterPdfUrl | 委員名簿PDF | https://... |
| summary | 要約 | ・ステーブルコイン... |
| summaryLen | 要約文字数 | 2500 |
| sourceTag | ソース種別 | YouTube字幕 / 議事録HTML |
| timestamp | 処理日時 | 2025-11-13T10:00:00Z |

| ... | ... | ... |
| **phase** | **通知フェーズ** | **awaiting_minutes / completed** |  ← 変更
| **resourcesSentAt** | **資料公開通知日時** | **2025-11-13T10:00:00Z** |
| **summarySentAt** | **要約送信日時** | **2025-12-20T09:00:00Z** |  ← 変更
| **gijirokuUrl** | **議事録URL** | **https://...** |

**phase の値**:
- `awaiting_minutes`: 資料公開通知済み、議事録未公開（金融庁のみ）  ← 変更
- `completed`: 要約送信済み（経産省・金融庁共通）  ← 変更

**phase命名の意図**:
- `awaiting_minutes` = 議事録（minutes）待ち状態
- `completed` = 処理完了状態
- 旧名称（`resources`/`summary`）から変更予定
---

## 🔒 セキュリティ

### VPSセキュリティ
- **fail2ban**: 不正アクセス検知・自動ブロック
- **SSL/TLS**: Let's Encrypt証明書
- **ファイアウォール**: UFW設定
- **Docker分離**: コンテナ化
- **Basic認証**: 計画中

### GASセキュリティ
- **API Key管理**: スクリプトプロパティ
- **HTTPS通信**: 全通信暗号化
- **エラーハンドリング**: 詳細ログ記録

### セキュリティインシデント対応
- 2025-11-13: サイバー攻撃を検知・復旧完了（約4時間）
- fail2banによる自動ブロック機能が有効

---

## 📁 ファイル構成

```
public-mtg-monitor2/
├── src/
│   ├── main.gs                 # エントリーポイント
│   ├── config.gs               # 設定
│   ├── daily-check.gs          # 監視メイン処理
│   ├── scraper.gs              # スクレイピング（経産省）
│   ├── scraper-fsa.gs          # スクレイピング（金融庁）
│   ├── processor.gs            # コンテンツ処理
│   ├── gemini.gs               # Gemini API
│   ├── mailer.gs               # メール配信
│   ├── recipients.gs           # 購読者管理
│   ├── archive.gs              # Archive管理
│   ├── vps-client.gs           # VPS連携
│   ├── utils.gs                # ユーティリティ
│   └── security-monitor.gs     # セキュリティ監視
├── meeting-manager.gs          # 会議追加・管理ツール ← 新規
├── meeting-structure-analyzer.gs  # 会議構造分析ツール ← 新規
├── webapp.gs                   # 公開Webページ ← 新規
├── vps/
│   ├── fetcher/                # Node.js Webスクレイパー
│   │   ├── index.js
│   │   └── package.json
│   └── asr/                    # Python OCR/字幕取得
│       ├── app.py
│       ├── Dockerfile
│       └── requirements.txt
├── docs/
│   ├── README.md               # このファイル
│   ├── ROADMAP.md              # 開発ロードマップ
│   ├── ARCHITECTURE.md         # 詳細設計
│   └── TROUBLESHOOTING.md      # 運用手順
└── .clasp.json
```

---

## 🚀 セットアップ

### 1. Google Apps Script

```bash
# リポジトリのクローン
git clone https://github.com/yourusername/public-mtg-monitor2.git
cd public-mtg-monitor2

# clasp でログイン
clasp login

# 新規GASプロジェクト作成
clasp create --type standalone --title "政府会議ウォッチャー"

# コードをプッシュ
clasp push
```

### 2. Googleシート作成

#### sources シート
| id | agency | name | indexUrl | active | note |
|----|--------|------|----------|--------|------|
| 1 | 経済産業省 | 同時市場の在り方等に関する検討会 | https://... | TRUE | |

#### recipients シート
| email | name | sources | active |
|-------|------|---------|--------|
| admin@example.com | 管理者 | all | TRUE |

#### archive シート
| timestamp | sourceId | meetingId | title | sentTo | status |
|-----------|----------|-----------|-------|--------|--------|

### 3. スクリプトプロパティ設定

```javascript
// GASエディタ > プロジェクトの設定 > スクリプトプロパティ

GEMINI_API_KEY = "your-gemini-api-key"
VPS_FETCH_BASE = "https://fetch.klammer.co.jp"
VPS_FETCH_TOKEN = "your-token"
SOURCES_SHEET_ID = "your-sources-sheet-id"
RECIPIENTS_SHEET_ID = "your-recipients-sheet-id"
ARCHIVE_SHEET_ID = "your-archive-sheet-id"
```

### 4. VPS セットアップ

#### 初期セットアップ
```bash
# fetcher起動（PM2）
cd /root/fetcher
pm2 start index.js --name fetcher
pm2 save

# asr起動（Docker）
cd /root/asr
docker-compose up -d

# Nginx設定確認
sudo nano /etc/nginx/sites-enabled/default
# port 3000を指定
sudo systemctl reload nginx
```

#### ⚠️ Deno & yt-dlp セットアップ（重要）

YouTube字幕取得に必須：
```bash
# 1. Denoインストール
cd /tmp
curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o deno.zip
apt install unzip
unzip deno.zip
docker cp deno asr_asr_1:/usr/local/bin/
docker exec -it asr_asr_1 chmod +x /usr/local/bin/deno

# 2. yt-dlp最新版にアップデート
docker exec -it asr_asr_1 pip install -U yt-dlp --break-system-packages

# 3. 確認
docker exec -it asr_asr_1 deno --version  # 2.5.6以降
docker exec -it asr_asr_1 pip show yt-dlp  # 2025.11.12以降

# 4. cookieファイル配置
# /root/asr/cookies.txt に配置（docker-compose.yml でマウント済み）

# 5. 動作確認
curl -X POST https://fetch.klammer.co.jp/asr/youtube-subs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VPS_FETCH_TOKEN" \
  -d '{"url":"https://youtube.com/live/-pU-YnMDq8M"}'
```

#### Dockerfileへの反映（推奨）

将来の再構築時のために、Dockerfileに追加：
```dockerfile
# /root/asr/Dockerfile に追加

# Denoのインストール
RUN apt-get update && apt-get install -y curl unzip && \
    curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip && \
    unzip /tmp/deno.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/deno && \
    rm /tmp/deno.zip && \
    apt-get clean

# yt-dlpを最新版に固定
RUN pip install yt-dlp==2025.11.12 --break-system-packages
```

### 5. トリガー設定

```
GASエディタ > トリガー > トリガーを追加

関数: dailyCheckAll
イベントソース: 時間主導型
時刻ベースのトリガー: 日タイマー
時刻: 午前9時～10時
```

---

## 🔄 運用フロー

### 日次運用（自動）

```
09:00 JST - dailyCheckAll() 実行
  ↓
14会議を順次チェック
  ↓
新着会議を検知
  ↓
PDF OCR + YouTube字幕取得
  ↓
Gemini で要約生成
  ↓
購読者にメール配信
  ↓
管理者にレポート送信
```

### 管理者タスク

#### 毎日
- レポートメール確認
- エラー・アラート対応

#### 週次
- セキュリティログ確認（fail2ban）
- システム稼働状況確認

#### 月次
- 購読者管理
- 監視会議の見直し
- コスト確認

---
## 🎯 会議管理システム

### meeting-manager.gs
- 会議の追加・削除・更新を効率化
- 複合ID形式（METI_001形式）で管理
- 重複チェック機能
- 一括追加機能

### meeting-structure-analyzer.gs
- 新規会議サイトの構造を自動分析
- スクレイピング可能性を評価（スコア100点満点）
- YouTube字幕・PDF資料の可用性チェック
- 実装難易度の自動判定

### 公開Webページ
- URL: https://script.google.com/macros/s/[ID]/exec
- 監視対象会議の一覧表示
- リアルタイム検索機能
- 省庁別フィルター
- レスポンシブ対応

## 🔍 トラブルシューティング

### よくある問題

#### 1. VPS全体がダウン
```
原因: サイバー攻撃、システム障害
対応手順:
1. VPSにSSH接続
2. fail2banログ確認: sudo tail -f /var/log/fail2ban.log
3. サービス再起動:
   - fetcher: pm2 restart fetcher
   - asr: docker restart asr-asr-1
4. Nginx確認: sudo systemctl status nginx
5. 設定確認: cat /etc/nginx/sites-enabled/default
```

#### 2. PDF処理が失敗する
```
原因: asrコンテナがダウン
対応: docker restart asr-asr-1
```

#### 3. YouTube字幕が取得できない

##### エラー: "No video formats found!"

**原因**: YouTube PO Token認証に対応していない（yt-dlp バージョンが古い）

**診断**:
```bash
# yt-dlpバージョン確認
docker exec -it asr_asr_1 pip show yt-dlp

# 期待値: 2025.11.12以降
```

**解決策**:
```bash
# 1. yt-dlpを最新版に更新
docker exec -it asr_asr_1 pip install -U yt-dlp --break-system-packages

# 2. 再起動
docker-compose restart

# 3. テスト
curl -X POST https://fetch.klammer.co.jp/asr/youtube-subs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VPS_FETCH_TOKEN" \
  -d '{"url":"https://www.youtube.com/watch?v=test"}'
```

##### エラー: "Requested format is not available"

**原因**: Denoがインストールされていない（PO Token生成に必要）

**診断**:
```bash
# Deno確認
docker exec -it asr_asr_1 deno --version

# 期待値: deno 2.5.6以降
```

**解決策（Denoがない場合）**:
```bash
# VPS側で
cd /tmp
curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o deno.zip
apt install unzip  # 必要に応じて
unzip deno.zip

# コンテナにコピー
docker cp deno asr_asr_1:/usr/local/bin/
docker exec -it asr_asr_1 chmod +x /usr/local/bin/deno

# 確認
docker exec -it asr_asr_1 deno --version

# 再起動
docker-compose restart
```

##### エラー: "Sign in to confirm you're not a bot"

**原因**: cookieファイルが期限切れまたは無効

**診断**:
```bash
# cookie確認
docker exec -it asr_asr_1 ls -la /app/cookies.txt
docker exec -it asr_asr_1 grep LOGIN_INFO /app/cookies.txt
```

**解決策**:
```bash
# 1. ブラウザでYouTubeにログイン
# 2. Chrome拡張「Get cookies.txt LOCALLY」で cookies.txt を取得
# 3. VPSにアップロード
scp cookies.txt root@your-vps:/root/asr/

# 4. 再起動
docker-compose restart
```

#### デバッグモード（詳細ログ確認）

問題発生時、詳細なログを出力する方法：
```bash
# 1. docker-compose.yml 編集
nano /root/asr/docker-compose.yml

# environment に追加
environment:
  - DEBUG_MODE=true

# 2. 再起動
docker-compose restart

# 3. ログをリアルタイム監視
docker logs -f asr_asr_1

# 4. テスト実行（別ターミナル）
curl -X POST https://fetch.klammer.co.jp/asr/youtube-subs ...

# 5. 問題解決後、DEBUG_MODE=false に戻す
```

#### 4. Gemini APIエラー
```
原因: レート制限、API Key問題
対応: 
- レート制限 → 再試行
- API Key → スクリプトプロパティ確認
```

#### 5. fetcherが503エラー
```
原因: Nginxのproxy_pass設定ミス
対応:
1. sudo nano /etc/nginx/sites-enabled/default
2. proxy_pass http://127.0.0.1:3000 を確認
3. sudo nginx -t
4. sudo systemctl reload nginx
```

### ログ確認

#### GAS
```javascript
// GASエディタ > 実行数
// または
Logger.log() の出力を確認
```

#### VPS
```bash
# fetcherログ
pm2 logs fetcher --lines 50

# asrログ
docker logs asr-asr-1 | tail -50

# Nginxログ
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# fail2banログ
sudo tail -f /var/log/fail2ban.log
```
## 🐛 既知の問題・制約事項

### 1. YouTube字幕取得の制限（制約）
**制限**: 日本語字幕が設定されている動画のみ対応
**影響**: 
- 字幕がない動画は文字起こしができず、要約も生成されません
- 英語字幕のみの動画には対応していません
**対応案**:
- Whisper ASRによる直接文字起こし（VPS側でWhisperは既に搭載済み）
- コスト・時間がかかるため、現時点では字幕優先で運用

---

### 2. PDF OCR精度（優先度: 低）
**問題**: 議事次第PDFのOCR（文字認識）が一部失敗する
**影響**: 
- 議題情報が不完全になる場合がある
- フォールバック機能で回避中（経産省：タイトルから生成、金融庁：資料リストから推測）
**対応案**:
- VPS側でPyMuPDFによる直接テキスト抽出を優先し、失敗時のみOCRにフォールバック
**注**: フォールバックで動作しているため緊急性は低い

---

### 3. VPS依存性
**制限**: YouTube字幕取得、PDF OCR、Webスクレイピングは全てVPS（fetch.klammer.co.jp）に依存
**影響**: VPSダウン時は新着会議の検知・処理が停止
**対応**: VPSの監視とバックアップ体制の整備

### 4. 経産省PDF取得エラー（優先度: 中）
**問題**: 経産省の議事次第PDFが401エラーで取得できない
**影響**: 
- 議題情報がPDFから取得できず、フォールバック（タイトルから生成）を使用
- 要約の品質が若干低下する可能性
**原因**: VPS側fetcherのHTTPヘッダー不足の可能性
**対応状況**: VPS側の修正を試行中
**回避策**: フォールバック機能により議題は生成されるため、システムは稼働可能
---

## ✅ 解決済み

### 金融庁の議事録監視（2025-11-14解決）
- `checkFsaGijiyoshi_()`を実装
- `dailyCheckAll()`から自動実行
- archiveの`phase='resources'`会議について議事録公開を監視

### 金融庁会議の議題抽出（2025-11-14解決）
- `extractAgendaFromFsaResourcePage_()`を実装
- 配付資料リストから議題を自動生成
---

## 📊 監視・メトリクス

### 主要KPI
- **稼働率**: 99%以上
- **エラー率**: 5%以下
- **平均処理時間**: 会議あたり2-3分
- **メール配信成功率**: 95%以上
- **復旧時間**: 4時間以内

### ダッシュボード
- Archive シート: 配信履歴
- 管理者レポート: 日次サマリー
- VPSログ: システム状態

---

## 🔮 今後の展開

詳細は **[ROADMAP.md](docs/ROADMAP.md)** を参照

### Phase 1: 運用安定化（現在）
- ✅ 14会議監視体制
- ✅ VPS復旧手順確立
- [ ] 自動バックアップ
- [ ] セキュリティ強化

### Phase 2: スケーラビリティ（2-3週間）
- [ ] 20会議 → 100会議への拡大
- [ ] グループ分割処理
- [ ] エラーハンドリング強化

### Phase 3: 課金基盤（1ヶ月）
- [ ] Stripe統合
- [ ] ユーザー管理
- [ ] サブスクリプション

### Phase 4: プレミアム機能（2ヶ月）
- [ ] キーワードアラート
- [ ] カスタム配信
- [ ] 高度な分析

---

## 📞 サポート

### 開発者
- **名前**: Toshihiro Higaki
- **会社**: Klammer Corporation
- **Email**: toshihiro.higaki@klammer.co.jp

### ドキュメント
- **ROADMAP**: [docs/ROADMAP.md](docs/ROADMAP.md) - 開発計画
- **ARCHITECTURE**: 詳細設計（作成予定）
- **TROUBLESHOOTING**: 運用手順（作成予定）

### リポジトリ
- **GitHub**: (private repository)
- **Issue**: GitHub Issues

---

## 📄 ライセンス

Private - All Rights Reserved

---

**最終更新**: 2025-11-13  
**バージョン**: 0.3.1  
**次回マイルストーン**: Phase 1完了（20会議監視、自動バックアップ）
