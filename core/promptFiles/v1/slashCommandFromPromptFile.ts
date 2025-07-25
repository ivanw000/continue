import { ContinueSDK, SlashCommand } from "../..";
import { getDiffsFromCache } from "../../autocomplete/snippets/gitDiffCache";
import { renderChatMessage } from "../../util/messageContent";
import { getLastNPathParts } from "../../util/uri";
import { parsePromptFileV1V2 } from "../v2/parsePromptFileV1V2";
import { renderPromptFileV2 } from "../v2/renderPromptFile";

import { getContextProviderHelpers } from "./getContextProviderHelpers";
import { renderTemplatedString } from "./renderTemplatedString";
import { replaceSlashCommandWithPromptInChatHistory } from "./updateChatHistory";

export function extractName(preamble: { name?: string }, path: string): string {
  return preamble.name ?? getLastNPathParts(path, 1).split(".prompt")[0];
}

async function renderPromptV1(
  prompt: string,
  context: ContinueSDK,
  userInput: string,
) {
  const helpers = getContextProviderHelpers(context);

  const inputData: Record<string, string> = {
    input: userInput,
  };

  // A few context providers that don't need to be in config.json to work in .prompt files
  if (helpers?.find((helper) => helper[0] === "diff")) {
    const diffs = await getDiffsFromCache(context.ide);
    inputData.diff = diffs.join("\n");
  }
  if (helpers?.find((helper) => helper[0] === "currentFile")) {
    const currentFile = await context.ide.getCurrentFile();
    if (currentFile) {
      inputData.currentFile = currentFile.path;
    }
  }

  return renderTemplatedString(
    prompt,
    context.ide.readFile.bind(context.ide),
    inputData,
    helpers,
  );
}

export function slashCommandFromPromptFileV1(
  path: string,
  content: string,
): SlashCommand | null {
  const { name, description, systemMessage, prompt } = parsePromptFileV1V2(
    path,
    content,
  );

  return {
    name,
    description,
    prompt,
    promptFile: path,
    run: async function* (context) {
      const [_, renderedPrompt] = await renderPromptFileV2(prompt, {
        config: context.config,
        fullInput: context.input,
        embeddingsProvider: context.config.modelsByRole.embed[0],
        reranker: context.config.modelsByRole.rerank[0],
        llm: context.llm,
        ide: context.ide,
        selectedCode: context.selectedCode,
        fetch: context.fetch,
      });

      const messages = replaceSlashCommandWithPromptInChatHistory(
        context.history,
        name,
        renderedPrompt,
        systemMessage,
      );

      for await (const chunk of context.llm.streamChat(
        messages,
        context.abortController.signal,
        context.completionOptions,
      )) {
        yield renderChatMessage(chunk);
      }
    },
  };
}
