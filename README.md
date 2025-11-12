# 政府会議ウォッチャー（Government Meeting Monitor）

経済産業省をはじめとした政府会議を自動監視し、新着情報をメール配信するサービス

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Status: Beta](https://img.shields.io/badge/Status-Beta-orange.svg)]()

## 📋 概要

政府の審議会・検討会・小委員会などの会議を自動監視し、新着会議が開催されたら以下を自動で実行：

- 📄 PDF（議事次第・委員名簿）のOCR
- 🎥 YouTube字幕の自動取得
- 🤖 Gemini 2.5による要約生成
- 📧 購読者へのメール配信
- 🗄️ 会議履歴のアーカイブ

## ✨ 主要機能

### 実装済み
- ✅ 8会議の自動監視（経済産業省中心）
- ✅ 新着会議の自動検知
- ✅ PDF OCR（VPS/Tesseract）
- ✅ YouTube字幕取得（VPS/yt-dlp）
- ✅ Gemini 2.5による要約生成
- ✅ メール配信システム
- ✅ 購読管理（配信停止・再登録）
- ✅ 会議履歴アーカイブ
- ✅ セキュリティ監視（Rate Limiting、異常検知）

### 開発中・予定
- 🚧 監視会議の拡大（20→100会議）
- 🚧 キーワードアラート機能
- 🚧 カスタム配信フォーマット
- 🚧 課金システム（Stripe）
- 🚧 ユーザーごとの会議選択

## 🏗️ 技術スタック

### フロントエンド
- Google Apps Script（Webアプリ）
- HTML/CSS

### バックエンド
- **Google Apps Script**
  - メインロジック、スケジューラ、メール配信
  
- **VPS（Docker）**
  - Fetcher: Playwright（スクレイピング）
  - OCR: Tesseract（PDF文字認識）
  - ASR: yt-dlp（YouTube字幕取得）

### AI
- Google Gemini 2.5 Flash（要約生成）

### 決済（予定）
- Stripe

## 📊 システムアーキテクチャ

```
┌─────────────┐
│   ユーザー   │
└──────┬──────┘
       │ メール受信
       │
┌──────▼──────────────────┐
│   Google Apps Script    │
│  - dailyCheckAll        │
│  - メール配信            │
│  - Webアプリ             │
│  - セキュリティ監視      │
└──────┬──────────────────┘
       │ API呼び出し
       │
┌──────▼──────┐  ┌──────────┐
│    VPS      │  │  Gemini  │
│ - Fetcher   │  │   API    │
│ - OCR       │  └──────────┘
│ - ASR       │
└─────────────┘
```

## 🚀 セットアップ

詳細は [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) を参照

### 必要な環境
- Google Workspace アカウント（有料版推奨）
- VPS（Docker対応）
- Gemini API キー
- Node.js（clasp使用時）

### クイックスタート

```bash
# 1. リポジトリをクローン
git clone https://github.com/kl-higa/public-mtg-monitor2.git

# 2. clasp導入
npm install -g @google/clasp
clasp login

# 3. GASプロジェクトにプッシュ
clasp push

# 4. Script Propertiesを設定
# GASエディタで設定が必要

# 5. トリガー設定
# dailyCheckAll を毎日0時に実行
```

## 📚 ドキュメント

- [開発ロードマップ](docs/ROADMAP.md) - 今後の開発計画
- [システム設計](docs/ARCHITECTURE.md) - 詳細なアーキテクチャ
- [開発ガイド](docs/DEVELOPMENT.md) - セットアップ・開発方法
- [セキュリティ](docs/SECURITY.md) - セキュリティ対策

## 🔐 セキュリティ

- ✅ Rate Limiting（10回/時間）
- ✅ HMACトークン認証
- ✅ セキュリティログ
- ✅ 異常検知・管理者通知
- ✅ VPS接続監視
- ✅ 入力値検証（XSS対策）

## 📈 ロードマップ

### Phase 1: UX改善（2週間）
- メールに購読会議リスト表示
- 全会議一覧ページ強化

### Phase 2: 課金基盤（1ヶ月）
- Stripe統合、プラン管理

### Phase 3: プレミアム機能（2ヶ月）
- キーワードアラート、カスタム配信

### Phase 4: β版リリース（3ヶ月）
- マーケティング、ユーザーテスト

詳細は [docs/ROADMAP.md](docs/ROADMAP.md) を参照

## 📝 ライセンス

MIT License

## 👤 Author

**Toshihiro Higaki**
- Company: Klammer Corporation
- Email: toshihiro.higaki@klammer.co.jp

---

© 2025 Klammer Corporation. All rights reserved.
