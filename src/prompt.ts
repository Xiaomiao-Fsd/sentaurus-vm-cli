import { createInterface } from "node:readline/promises";
import process from "node:process";

export async function askLine(prompt: string, defaultValue = ""): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await readline.question(`${prompt}${suffix}: `)).trim();
    return answer || defaultValue;
  } finally {
    readline.close();
  }
}

export async function askSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return askLine(prompt);
  }
  process.stdout.write(`${prompt}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let value = "";
  return await new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      for (const character of text) {
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && character !== "\u007f") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}
