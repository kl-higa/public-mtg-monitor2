# Changelog

政府会議ウォッチャーの変更履歴

---

## [Unreleased]

### Phase 1予定
- メールに購読会議リスト表示
- 全会議一覧ページ強化
- 監視会議を20に拡大
- グループ分割処理の実装

---

## [0.2.0] - 2025-11-12

### Added
- ✨ セキュリティ監視システム
  - Rate Limiting（10回/時間）
  - セキュリティログ記録
  - 異常検知・管理者通知
  - 1時間ごとの自動監視
- ✨ VPS接続監視
- ✨ セキュリティダッシュボード
- ✨ グループ分割処理（100会議対応）
- ✨ 管理者向け実行レポート（dailyCheckAll）

### Changed
- 🔧 VPSエンドポイントの修正
  - fetchViaVps_: GET + クエリパラメータ方式に変更
  - extractPdfTextViaVps_: /asr/pdf に変更
  - fetchSubsViaVps_: ASR_TOKENを使用
- 🔧 エラーハンドリングの改善

### Fixed
- 🐛 VPS APIリクエスト方式の修正
- 🐛 トークン設定の修正

---

## [0.1.0] - 2025-11-01

### Added
- ✨ 初期リリース
- ✨ 8会議の自動監視（経済産業省）
- ✨ PDF OCR（議事次第・委員名簿）
- ✨ YouTube字幕取得
- ✨ Gemini 2.5による要約生成
- ✨ メール配信システム
- ✨ 購読管理（配信停止・再登録）
- ✨ HMACトークン認証
- ✨ 会議履歴Archive
- ✨ VPS連携（Fetcher/OCR/ASR）

### Technical
- Google Apps Script
- VPS (Docker: Playwright, Tesseract, yt-dlp)
- Gemini API
- Google Workspace

---

## 記法

- ✨ Added: 新機能
- 🔧 Changed: 変更
- 🐛 Fixed: バグ修正
- 🗑️ Removed: 削除
- ⚠️ Deprecated: 非推奨
- 🔒 Security: セキュリティ
