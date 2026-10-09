# Next.js Static Site Template

Next.js 16 + React 19 + TypeScript を使用した静的サイト生成のテンプレートリポジトリです。GitHub Pages へのデプロイが自動化されています。

## 技術スタック

- **Next.js** 16 - App Router / Static Export
- **React** 19
- **TypeScript** 5
- **ESLint** 9 - Flat Config
- **Prettier** 3

## このテンプレートの使い方

1. **「Use this template」ボタン**をクリックして新しいリポジトリを作成
2. リポジトリをクローン
   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
   cd YOUR_REPO
   ```
3. 依存関係をインストール
   ```bash
   pnpm install
   ```
4. 開発サーバーを起動
   ```bash
   pnpm dev
   ```

## セットアップ後にやること

### 1. `next.config.js` の修正

`basePath` をリポジトリ名に変更してください：

```js
basePath: process.env.NODE_ENV === "production" ? "/YOUR_REPO_NAME" : "",
```

### 2. `app/layout.tsx` の修正

メタデータとサイト情報を更新してください：

```tsx
export const metadata: Metadata = {
  title: "Your Site Title",
  description: "Your site description",
}
```

### 3. GitHub Pages の設定

1. リポジトリの **Settings** → **Pages** へ移動
2. **Source** を「GitHub Actions」に設定

## ディレクトリ構成

```
.
├── app/
│   ├── layout.tsx      # ルートレイアウト
│   ├── page.tsx        # ホームページ
│   └── reset.css       # CSSリセット
├── .github/
│   └── workflows/
│       ├── lint.yml    # リント自動実行
│       └── deploy.yml  # GitHub Pages 自動デプロイ
├── next.config.js      # Next.js 設定
├── tsconfig.json       # TypeScript 設定
├── eslint.config.mjs   # ESLint 設定
└── .prettierrc.json    # Prettier 設定
```

## スクリプト

| コマンド | 説明 |
|---------|------|
| `pnpm dev` | 開発サーバーを起動 |
| `pnpm build` | 静的サイトをビルド（`/out` に出力） |
| `pnpm lint` | ESLint を実行 |
| `pnpm format` | Prettier でコードをフォーマット |
| `pnpm typecheck` | TypeScript の型チェック |

## 機能

- **静的サイト生成** - `next build` で `/out` に HTML を出力
- **自動デプロイ** - main ブランチへの push で GitHub Pages に自動デプロイ
- **自動リント** - push 時に ESLint / Prettier チェックを実行
- **依存関係の自動更新** - Dependabot による週次チェック
- **エディタ設定** - VS Code での自動フォーマット設定済み

## ライセンス

ISC
