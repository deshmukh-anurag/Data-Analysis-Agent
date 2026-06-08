export interface EvalExample {
  inputs: { question: string };
  outputs: {
    mustMention: string[];
    expectsTool?: string;
    expectsChart?: boolean;
  };
}

export const datasetName = "data-anal-agent-smoke";

export const datasetDescription =
  "Smoke-test questions for the data-anal-agent (sales_transactions, Nov–Dec 2021).";

export const examples: EvalExample[] = [
  {
    inputs: { question: "how many stores are in the dataset?" },
    outputs: {
      mustMention: ["5"],
      expectsTool: "lookup_sales_data",
    },
  },
  {
    inputs: { question: "what was total revenue per store in November 2021?" },
    outputs: {
      mustMention: ["store", "revenue"],
      expectsTool: "lookup_sales_data",
    },
  },
  {
    inputs: {
      question:
        "which SKU sold the most units while on promotion across the whole period?",
    },
    outputs: {
      mustMention: ["SKU-"],
      expectsTool: "lookup_sales_data",
    },
  },
  {
    inputs: {
      question:
        "compare average sale value when items are on promotion vs not on promotion",
    },
    outputs: {
      mustMention: ["promo", "average"],
      expectsTool: "lookup_sales_data",
    },
  },
  {
    inputs: {
      question: "show me a bar chart of total revenue by store",
    },
    outputs: {
      mustMention: ["store"],
      expectsTool: "generate_visualization",
      expectsChart: true,
    },
  },
];
