import * as vscode from "vscode";

export async function getApiKey(): Promise<string | undefined> {
  let apiKey = vscode.workspace.getConfiguration("openSourcerer").get<string>("apiKey");

  if (!apiKey) {
    apiKey = await vscode.window.showInputBox({
      prompt: "Enter your OpenRouter API Key",
      placeHolder: "sk-...",
      ignoreFocusOut: true,
      password: true, // Hides input for security
    });

    if (apiKey) {
      await saveApiKey(apiKey);
    }
  }

  return apiKey;
}

export function getSelectedModel(): string {
  return vscode.workspace.getConfiguration("openSourcerer").get<string>("chatModel") ?? "google/gemma-3-27b-it:free";
}

export async function saveApiKey(apiKey: string) {
  await vscode.workspace.getConfiguration("openSourcerer").update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
}

export async function saveModel(model: string) {
  await vscode.workspace.getConfiguration("openSourcerer").update("chatModel", model, vscode.ConfigurationTarget.Global);
}

export async function getApiUrl(): Promise<string> {
    let apiUrl = vscode.workspace.getConfiguration("openSourcerer").get<string>("apiUrl");
  
    if (!apiUrl) {
      apiUrl = await vscode.window.showInputBox({
        prompt: "Enter OpenRouter API URL (Default: https://openrouter.ai/api/v1/chat/completions)",
        placeHolder: "https://your-custom-openrouter-instance.com",
        ignoreFocusOut: true,
      });
  
      if (apiUrl) {
        await saveApiUrl(apiUrl);
      } else {
        apiUrl = "https://openrouter.ai/api/v1/chat/completions"; // Default OpenRouter URL
      }
    }
  
    return apiUrl;
  }
  
  export async function saveApiUrl(apiUrl: string) {
    await vscode.workspace.getConfiguration("openSourcerer").update("apiUrl", apiUrl, vscode.ConfigurationTarget.Global);
  }
  