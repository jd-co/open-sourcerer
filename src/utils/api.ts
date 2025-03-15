import axios from "axios";
import { getApiKey, getApiUrl, getSelectedModel } from "./config";
import * as vscode from "vscode";

export async function sendMessageToOpenRouter(
  prompt: string,
  codeContext: string = "",
  chatHistory: { role: 'user' | 'assistant', content: string }[] = []
) {
  try {
    const apiKey = vscode.workspace.getConfiguration("openSourcerer").get<string>("apiKey");
    if (!apiKey) {
      throw new Error("OpenRouter API key not found. Please set it in settings.");
    }
    const model = getSelectedModel();
    console.log("Using model:", model);

    // Get the last user message from chat history
    const lastUserMessage = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1].content : prompt;

    // Construct messages array with chat history
    const messages = [
      { role: "system", content: prompt },
      ...chatHistory.slice(0, -1).map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      // Add user's message with code context if it exists
      {
        role: "user",
        content: codeContext.length > 1 ? `${lastUserMessage}\n\nCode Context:\n${codeContext}` : lastUserMessage
      }
    ];

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: model,
        messages: messages,
        context: codeContext
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    // console.log("OpenRouter API Response:", JSON.stringify(response.data, null, 2));

    // Handle different response formats
    if (response.data.choices?.[0]?.message?.content) {
      return response.data.choices[0].message.content;
    } else if (response.data.message?.content) {
      return response.data.message.content;
    } else if (response.data.content) {
      return response.data.content;
    } else {
      console.error("Unexpected response format:", response.data);
      return "Sorry, I received an unexpected response format from the API.";
    }
  } catch (error: any) {
    console.error("OpenRouter API Error:", error);
    if (error.response?.data?.error?.message) {
      throw new Error(error.response.data.error.message);
    } else if (error.response?.data?.message) {
      throw new Error(error.response.data.message);
    } else {
      throw new Error(error.message || "Failed to get response from OpenRouter API");
    }
  }
}
