import { Client } from "langsmith";
import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import type { EvaluationResult } from "langsmith/evaluation";
import { evaluate } from "langsmith/evaluation";
import * as dotenv from "dotenv";

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
  
  // LangSmithにデータセットを作成
  const dataset = await client.createDataset("Sample dataset", {
    description: "A sample dataset in LangSmith.",
  });
  
// データセットにデータを追加
for (let i = 0; i < inputs.length; i++) {
  await client.createExample({
    inputs: inputs[i],
    outputs: outputs[i],
    dataset_id: dataset.id,
  });
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

// 評価の実行後、langsmithで結果を表示するためのリンクが提供されます
await evaluate(
    // SDKは自動的にデータセットのinputをターゲット関数に送信します
    (exampleInput) => {
      return target(exampleInput.question);
    },
    {
      data: "Sample dataset",
      evaluators: [
        accuracy,
        // ここに複数の評価項目を追加できます
      ],
      experimentPrefix: "first-eval-in-langsmith",
      maxConcurrency: 2,
    }
  );
