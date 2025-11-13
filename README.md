# 政府会議ウォッチャー - システム設計書

経済産業省・金融庁の政府会議を自動監視し、AIで要約してメール配信するシステム

**最終更新**: 2025-11-13  
**バージョン**: 0.3.1  
**監視会議数**: 14会議（経産省8 + 金融庁6）  
**稼働状況**: α版稼働中（VPS復旧完了）

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

### 技術スタック
- **GAS**: メインロジック、メール配信
- **Node.js (fetcher)**: Webスクレイピング
- **Python (asr)**: OCR、字幕取得
- **Nginx**: リバースプロキシ、SSL
- **Gemini API**: AI要約
- **VPS**: Ubuntu 24.04

### 最近の更新
- 2025-11-13: **VPS復旧完了**（サイバー攻撃からの復旧）
- 2025-11-13: Nginx設定修正（port 3000へ）
- 2025-11-12: 監視会議を11→14に拡大

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
1. 同時市場の在り方等に関する検討会
2. 電力システム改革の検証を踏まえた制度設計WG
3. 排出量取引制度小委員会
4. 製造業ベンチマーク検討WG
5. 発電ベンチマーク検討WG
6. GX推進のためのグリーン鉄研究会
7. 次世代の分散型電力システムに関する検討会
8. GXリーグにおけるサプライチェーンでの取組のあり方に関する研究会

### 金融庁（6会議）

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

#### 対象会議一覧
9. AI官民フォーラム
10. 暗号資産制度に関するワーキング・グループ
11. サステナビリティ情報の開示と保証のあり方に関するワーキング・グループ
12. 市場制度ワーキング・グループ
13. ディスクロージャーワーキング・グループ
14. コーポレートガバナンス・コードの改訂に関する有識者会議

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

#### archive シート
| timestamp | sourceId | meetingId | title | sentTo | status |
|-----------|----------|-----------|-------|--------|--------|
| 2025-11-13 10:00 | 1 | 20 | 第20回... | 5 | sent |

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
```
原因: 字幕が存在しない、またはyt-dlpエラー
対応: ログ確認、手動字幕確認
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
