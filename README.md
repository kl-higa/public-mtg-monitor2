# 政府会議ウォッチャー - システム設計書

経済産業省・金融庁の政府会議を自動監視し、AIで要約してメール配信するシステム

**最終更新**: 2025-11-12  
**バージョン**: 0.3.0  
**監視会議数**: 11会議（経産省8 + 金融庁3）

---

## 📊 システム概要

### ビジョン
政府会議の情報を民主化し、政策決定プロセスの透明性を高める

### 主要機能
- ✅ 11会議の自動監視（毎日09:00 JST）
- ✅ 新着会議の自動検知
- ✅ PDF OCR処理（VPS上でpdfplumber）
- ✅ YouTube字幕取得（yt-dlp）
- ✅ Gemini 2.0 Flash Experimentalによる要約
- ✅ 購読者へのメール配信
- ✅ Archive機能（送信済み会議の管理）
- ✅ セキュリティ監視（fail2ban、Basic認証）

### システム構成
```
┌─────────────────────────────────────────────────────┐
│ Google Apps Script (GAS)                            │
│ ├─ 会議監視・検知                                    │
│ ├─ 購読者管理                                        │
│ ├─ メール配信                                        │
│ └─ 全体オーケストレーション                          │
└─────────────────────────────────────────────────────┘
                        ↓↑ HTTP
┌─────────────────────────────────────────────────────┐
│ VPS (Ubuntu 24.04 LTS) - Docker                     │
│ ├─ fetcher: HTML取得                                 │
│ ├─ pdf-processor: PDF OCR                           │
│ ├─ youtube-processor: 字幕取得                       │
│ └─ security: fail2ban監視                            │
└─────────────────────────────────────────────────────┘
                        ↓↑ API
┌─────────────────────────────────────────────────────┐
│ Google Gemini API                                   │
│ └─ gemini-2.0-flash-exp (要約生成)                   │
└─────────────────────────────────────────────────────┘
```

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

#### 日付の取得
- HTML内の `<p>` タグから「令和X年X月X日」または「YYYY年MM月DD日」を抽出
- 全角・半角混在に対応

#### YouTube
- 会議ページ内に直接リンク（/watch?v=, /live/, youtu.be/）
- 配信がない会議も多い

#### 対象会議一覧
1. 同時市場の在り方等に関する検討会
2. 電力システム改革の検証を踏まえた制度設計WG
3. 排出量取引制度小委員会
4. 製造業ベンチマーク検討WG
5. 発電ベンチマーク検討WG
6. GX推進のためのグリーン鉄研究会
7. 次世代の分散型電力システムに関する検討会
8. GXリーグにおけるサプライチェーンでの取組のあり方に関する研究会

### 金融庁（3会議）

#### 会議の構造
```
会議トップページ (XXX_index.html)
├─ 開催通知 (kaisai/)
├─ 資料ページ (siryou/shiryou/gijishidai/) ← 当日公開
└─ 議事要旨ページ (gijiyoshi/gijiroku/)    ← 1-2ヶ月後
```

#### URL形式
- インデックス: `https://www.fsa.go.jp/singi/.../XXX_index.html`
- 資料ページ: `https://www.fsa.go.jp/singi/.../siryou/YYYYMMDD.html`
- ID形式: 日付（YYYYMMDD形式）

#### ディレクトリパターン
| 会議 | 資料 | 議事要旨 |
|------|------|----------|
| AI官民フォーラム | `siryou/` | `gijiyoshi/` |
| 暗号資産制度WG | `gijishidai/` | `gijiroku/` |
| サステナビリティ開示WG | `shiryou/` | `gijiroku/` |

#### 日付の取得
- HTML内の `<li>日時：令和X年X月X日` から抽出
- 全角数字に対応（令和７年 → 2025年）
- フォールバック: URLから `YYYYMMDD` を抽出

#### YouTube
- 個別動画リンク（/watch?v=, /live/, youtu.be/）のみ対象
- チャンネルリンク（/channel/）は除外
- 「後日配信予定」の場合はリンクなし

#### 対象会議一覧
9. AI官民フォーラム
10. 暗号資産制度に関するワーキング・グループ
11. サステナビリティ情報の開示と保証のあり方に関するワーキング・グループ

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

#### 会議ページ抽出

**経産省**: `extractMeetingPages_()`
- パターン: `/XXX/(\d{3,4})\.html`
- 例: `/020.html` → ID: 20

**金融庁**: `extractFsaMeetingPages_()`
- パターン: `/(siryou|shiryou|gijishidai)/(\d{8})\.html`
- 例: `/siryou/20251028.html` → ID: 20251028

#### 会議ページのスクレイピング

**経産省**: `scrapeMeetingPage_()`
```javascript
{
  title: "第20回 同時市場の在り方等に関する検討会",
  date: "2025年9月22日",
  format: "ハイブリッド形式",
  roster: "委員名簿PDFのURL",
  youtube: "https://www.youtube.com/watch?v=...",
  pdfs: [
    { url: "...", title: "議事次第", isAgenda: true, ... },
    { url: "...", title: "資料1", refType: "資料", refNo: 1, ... }
  ],
  pageUrl: "https://www.meti.go.jp/..."
}
```

**金融庁**: `scrapeFsaMeetingPage_()`
- 日付抽出: `<li>日時：令和X年X月X日` から
- YouTube: 個別動画のみ（チャンネルリンクを除外）
- PDF: 経産省と同じ構造

### 2. コンテンツ処理

#### `processMeeting_(mt, srcId)`
```
1. YouTube字幕取得（VPS）
2. PDF OCR処理（VPS）
3. コンテンツ統合
4. Gemini API で要約生成
5. メール本文作成
6. 購読者に配信
7. Archiveに保存
```

#### VPS連携

**HTML取得**: `fetchViaVps_(url)`
```javascript
const response = UrlFetchApp.fetch(VPS_URL + '/fetch', {
  method: 'POST',
  payload: JSON.stringify({ url, timeout: 30 }),
  headers: { 'Content-Type': 'application/json' },
  muteHttpExceptions: true
});
```

**PDF処理**: `/process-pdf`
- pdfplumber でテキスト抽出
- OCR処理（画像PDF対応）

**YouTube処理**: `/process-youtube`
- yt-dlp で字幕取得
- 自動生成字幕対応

### 3. 要約生成

#### Gemini API設定
```javascript
model: "gemini-2.0-flash-exp"
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

#### 配信ロジック
```javascript
function getRecipientsForSource_(sourceId) {
  const allRecipients = getRecipients_();
  return allRecipients.filter(r => {
    if (!r.sources || r.sources === 'all') return true;
    const ids = r.sources.split(',').map(s => parseInt(s.trim()));
    return ids.includes(sourceId);
  });
}
```

### 5. データ管理

#### state スクリプトプロパティ
```json
{
  "https://www.meti.go.jp/shingikai/.../XXX.html": {
    "lastId": 20,
    "lastUrl": "https://www.meti.go.jp/.../020.html",
    "lastMeetingDate": "2025年9月22日",
    "lastCheckedAt": "2025-11-12T05:00:00.000Z",
    "pendingSummary": null
  }
}
```

#### archive シート
| timestamp | sourceId | meetingId | title | sentTo | status |
|-----------|----------|-----------|-------|--------|--------|
| 2025-11-12 10:00 | 1 | 20 | 第20回... | 5 | sent |

---

## 🔒 セキュリティ

### VPSセキュリティ
- **Basic認証**: 全エンドポイント
- **fail2ban**: 不正アクセス検知・自動ブロック
- **ファイアウォール**: UFW設定
- **Docker分離**: コンテナ化

### GASセキュリティ
- **API Key管理**: スクリプトプロパティ
- **HTTPS通信**: 全通信暗号化
- **エラーハンドリング**: 詳細ログ記録

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
├── vps/
│   ├── docker-compose.yml
│   ├── fetcher/
│   ├── pdf-processor/
│   ├── youtube-processor/
│   └── security/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── CHANGELOG.md
│   └── ROADMAP.md
└── README.md
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
VPS_URL = "https://your-vps-domain.com"
VPS_AUTH = "username:password" (Base64エンコード)
SOURCES_SHEET_ID = "your-sources-sheet-id"
RECIPIENTS_SHEET_ID = "your-recipients-sheet-id"
ARCHIVE_SHEET_ID = "your-archive-sheet-id"
```

### 4. VPS セットアップ

```bash
# Docker Compose起動
cd vps
docker-compose up -d

# Basic認証設定（各Dockerfile内）
ENV BASIC_AUTH_USER=username
ENV BASIC_AUTH_PASS=password

# fail2ban設定
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
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
11会議を順次チェック
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

---

## 🔍 トラブルシューティング

### よくある問題

#### 1. PDF処理が失敗する
```
原因: VPSのpdf-processorがダウン
対応: docker-compose restart pdf-processor
```

#### 2. YouTube字幕が取得できない
```
原因: 字幕が存在しない、またはyt-dlpエラー
対応: ログ確認、手動字幕確認
```

#### 3. Gemini APIエラー
```
原因: レート制限、API Key問題
対応: 
- レート制限 → 再試行
- API Key → スクリプトプロパティ確認
```

#### 4. メール配信されない
```
原因: Gmail送信制限、購読設定ミス
対応:
- Gmail制限 → 1日の送信数確認
- 購読設定 → recipientsシート確認
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
# Dockerログ
docker-compose logs -f fetcher
docker-compose logs -f pdf-processor
docker-compose logs -f youtube-processor

# fail2banログ
sudo tail -f /var/log/fail2ban.log
```

---

## 📊 監視・メトリクス

### 主要KPI
- **稼働率**: 99%以上
- **エラー率**: 5%以下
- **平均処理時間**: 会議あたり2-3分
- **メール配信成功率**: 95%以上

### ダッシュボード
- Archive シート: 配信履歴
- 管理者レポート: 日次サマリー
- VPSログ: システム状態

---

## 🔮 今後の拡張

### Phase 1: スケーラビリティ（2-3週間）
- 20会議 → 100会議への拡大
- グループ分割処理の実装
- エラーハンドリング強化

### Phase 2: 課金基盤（1ヶ月）
- Stripe統合
- ユーザー管理
- サブスクリプション機能

### Phase 3: プレミアム機能（2ヶ月）
- キーワードアラート
- カスタム配信フォーマット
- 高度な分析

詳細は `docs/ROADMAP.md` 参照

---

## 📞 サポート

### 開発者
- **名前**: Toshihiro Higaki
- **会社**: Klammer Corporation
- **Email**: toshihiro.higaki@klammer.co.jp

### リポジトリ
- **GitHub**: (private repository)
- **Issue**: GitHub Issues

---

## 📄 ライセンス

Private - All Rights Reserved

---

**最終更新**: 2025-11-12  
**バージョン**: 0.3.0