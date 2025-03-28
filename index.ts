import { Client } from "langsmith";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type { EvaluationResult } from "langsmith/evaluation";
import { evaluate } from "langsmith/evaluation";
import * as dotenv from "dotenv";
import type { Dataset, Example } from "langsmith/schemas";

dotenv.config();

const client = new Client({
  apiKey: process.env.LANGSMITH_API_KEY,
});
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 入力と参照出力を作成
const examples: [string, string][] = [
    [
      "Which country is Mount Kilimanjaro located in?",
      "Mount Kilimanjaro is located in Tanzania.",
    ],
    ["What is Earth's lowest point?", 
     "Earth's lowest point is The Dead Sea."],
  ];
  
const inputs = examples.map(([inputPrompt]) => ({
  question: inputPrompt,
}));
const outputs = examples.map(([, outputAnswer]) => ({
  answer: outputAnswer,
}));

// データセット名を定義
const datasetName = "Sample dataset";

// 既存のデータセットを確認して、なければ作成
async function getOrCreateDataset() {
  try {
    // データセットの一覧を取得
    const datasetsIterable = client.listDatasets();
    const datasets: Dataset[] = [];
    for await (const dataset of datasetsIterable) {
      datasets.push(dataset);
    }
    
    // 同じ名前のデータセットを検索
    const existingDataset = datasets.find(dataset => dataset.name === datasetName);
    
    if (existingDataset) {
      console.log(`既存のデータセット "${datasetName}" を使用します（ID: ${existingDataset.id}）`);
      return existingDataset;
    } else {
      // 新しいデータセットを作成
      const newDataset = await client.createDataset(datasetName, {
        description: "A sample dataset in LangSmith.",
      });
      console.log(`新しいデータセット "${datasetName}" を作成しました（ID: ${newDataset.id}）`);
      return newDataset;
    }
  } catch (error) {
    console.error("データセットの取得または作成中にエラーが発生しました:", error);
    throw error;
  }
}

// データセットにデータがあるか確認して、なければ追加
async function addExamplesToDatasetIfNeeded(datasetId: string) {
  try {
    // データセット内の既存のサンプル数を確認
    const examplesIterable = client.listExamples({ datasetId });
    const examples: Example[] = [];
    for await (const example of examplesIterable) {
      examples.push(example);
    }
    
    if (examples.length === 0) {
      console.log("データセットにサンプルを追加します...");
      // データセットにデータを追加
      for (let i = 0; i < inputs.length; i++) {
        await client.createExample({
          inputs: inputs[i],
          outputs: outputs[i],
          dataset_id: datasetId,
        });
      }
      console.log(`${inputs.length}個のサンプルをデータセットに追加しました`);
    } else {
      console.log(`データセットには既に${examples.length}個のサンプルが存在します。追加はスキップします。`);
    }
  } catch (error) {
    console.error("サンプルの追加中にエラーが発生しました:", error);
    throw error;
  }
}

// 評価したいアプリケーションロジックをターゲット関数内で定義
async function target(inputs: string): Promise<{ response: string }> {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Answer the following question accurately" },
        { role: "user", content: inputs },
      ],
    });
    return { response: response.choices[0].message.content?.trim() || "" };
  }

// LLM評価者のための指示を定義
const instructions = `Evaluate Student Answer against Ground Truth for conceptual similarity and classify true or false: 
- False: No conceptual match and similarity
- True: Most or full conceptual match and similarity
- Key criteria: Concept should match, not exact wording.
`;

// LLM評価者のためのコンテキストを定義
const context = `Ground Truth answer: {reference}; Student's Answer: {prediction}`;

// LLM評価者の出力スキーマを定義
const ResponseSchema = z.object({
  score: z
    .boolean()
    .describe(
      "Boolean that indicates whether the response is accurate relative to the reference answer"
    ),
});

// 参照出力に対する応答の正確さを評価するLLM評価者を定義
async function accuracy({
  outputs,
  referenceOutputs,
}: {
  outputs?: Record<string, string>;
  referenceOutputs?: Record<string, string>;
}): Promise<EvaluationResult> {
  const response = await openai.chat.completions.create({
    // model: "o3-mini",
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: instructions },
      {
        role: "user",
        content: context
          .replace("{prediction}", outputs?.answer || "")
          .replace("{reference}", referenceOutputs?.answer || ""),
      },
    ],
    response_format: zodResponseFormat(ResponseSchema, "response"),
  });

  return {
    key: "accuracy",
    score: ResponseSchema.parse(
      JSON.parse(response.choices[0].message.content || "")
    ).score,
  };
}

// メイン処理
async function main() {
  // データセットを取得または作成
  const dataset = await getOrCreateDataset();
  
  // データセットにサンプルを追加（必要な場合のみ）
  await addExamplesToDatasetIfNeeded(dataset.id);

  // 評価の実行
  await evaluate(
    // SDKは自動的にデータセットのinputをターゲット関数に送信します
    (exampleInput) => {
      return target(exampleInput.question);
    },
    {
      data: datasetName,
      evaluators: [
        accuracy,
        // ここに複数の評価項目を追加できます
      ],
      experimentPrefix: "first-eval-in-langsmith",
      maxConcurrency: 2,
    }
  );
}

// メイン処理を実行
main().catch(error => {
  console.error("エラーが発生しました:", error);
  process.exit(1);
});
