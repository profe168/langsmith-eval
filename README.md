# LangSmith 評価ツール
## 概要

このプロジェクトは、LangSmithを使用してLLMの応答を評価するためのツールです。質問に対する回答の正確性を評価することができます。

## インストール

```bash
# Windows
npm install

# Mac/Linux
npm install
# package.jsonのstart命令を以下に変更
# "start": "NODE_OPTIONS=--loader=ts-node/esm ts-node index.ts"
```

## 環境設定

1. `.env`ファイルを作成し、以下の内容を設定してください：

```
LANGSMITH_API_KEY=your_langsmith_api_key
OPENAI_API_KEY=your_openai_api_key
```

## 使い方

1. データセットとデータの作成
   - コード内で質問と回答のペアを設定できます
   - 既存のデータセットがある場合は自動的に再利用されます

2. 評価の実行
   ```bash
   npm start
   ```

3. 評価結果の確認
   - [LangSmith Dashboard](https://smith.langchain.com/)にアクセスして結果を確認

## 評価項目

`evaluators`配列に評価項目を追加することで、複数の観点から評価できます。

- `accuracy`: 回答の正確性を評価
- その他のカスタム評価項目も追加可能

## 注意点

- `experimentPrefix`を変更することで、実験名を区別できます
- `maxConcurrency`で並行実行数を制御できます
- 評価にはOpenAIのモデルを使用しています（デフォルト: gpt-4o-mini）