import * as vscode from "vscode";
import { sendMessageToOpenRouter } from "../utils/api";
import { SYSTEM_PROMPTS } from "../prompts";
import { DEFAULT_MODELS, AIModel } from "../constants/models";
import * as fs from 'fs';
import * as path from 'path';
import marked from "marked";
import { saveModel } from "../utils/config";

export class ChatViewProvider {
  public static currentPanel: ChatViewProvider | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private customModels: AIModel[] = [];
  private readonly customModelsPath: string;
  private chatHistory: { role: 'user' | 'assistant', content: string }[] = [];

  private constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.customModelsPath = path.join(context.extensionPath, 'src', 'config', 'customModels.json');
    
    // Load custom models from config file
    this.loadCustomModels();

    this.panel = vscode.window.createWebviewPanel(
      "aiChat",
      "AI Chat",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    this.panel.webview.html = this.getWebviewContent();
    this.panel.webview.onDidReceiveMessage(this.handleMessage, this);
    this.panel.onDidDispose(() => (ChatViewProvider.currentPanel = undefined));

    // Restore webview state
    const state = this.context.workspaceState.get('chatModel');
    if (state) {
      this.panel.webview.postMessage({
        type: 'modelChanged',
        model: state
      });
    }
  }

  private loadCustomModels() {
    try {
      if (fs.existsSync(this.customModelsPath)) {
        const configContent = fs.readFileSync(this.customModelsPath, 'utf8');
        const config = JSON.parse(configContent);
        this.customModels = config.customModels || [];
      }
    } catch (error) {
      console.error('Error loading custom models:', error);
      this.customModels = [];
    }
  }

  private async saveCustomModels() {
    try {
      const config = {
        customModels: this.customModels
      };
      fs.writeFileSync(this.customModelsPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Error saving custom models:', error);
      vscode.window.showErrorMessage('Failed to save custom model. Please check file permissions.');
    }
  }

  public static showChatPanel(context: vscode.ExtensionContext) {
    if (ChatViewProvider.currentPanel) {
      ChatViewProvider.currentPanel.panel.reveal();
      // Auto-select current file if one is open
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        ChatViewProvider.currentPanel.panel.webview.postMessage({
          type: "fileSelected",
          filePath: activeEditor.document.uri.fsPath,
          isDefault: true
        });
      }
    } else {
      ChatViewProvider.currentPanel = new ChatViewProvider(context);
      // Auto-select current file if one is open
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        ChatViewProvider.currentPanel.panel.webview.postMessage({
          type: "fileSelected",
          filePath: activeEditor.document.uri.fsPath,
          isDefault: true
        });
      }
    }
  }

  private async handleMessage(message: any) {
    if (message.type === "chat") {
      let codeContext = "";
      
      // Get context from selected files
      if (message.files && message.files.length > 0) {
        const fileContents = await Promise.all(
          message.files.map(async (filePath: string) => {
            try {
              const uri = vscode.Uri.file(filePath);
              const document = await vscode.workspace.openTextDocument(uri);
              return `File: ${filePath}\n${document.getText()}\n\n`;
            } catch (error) {
              console.error(`Error reading file ${filePath}:`, error);
              return "";
            }
          })
        );
        codeContext = fileContents.join("\n");
      } else {
        // Fallback to active editor if no files selected
        const activeEditor = vscode.window.activeTextEditor;
        codeContext = activeEditor ? activeEditor.document.getText() : "";
      }

      // Add user message to chat history
      this.chatHistory.push({ role: 'user', content: message.text });

      const prompt = SYSTEM_PROMPTS.GENERAL_CHAT_ASSISTANT + `user query: ${message.text}`;
      // Send request to AI with code context and chat history
      const response = await sendMessageToOpenRouter(prompt, codeContext, this.chatHistory);
      
      // Add AI response to chat history
      this.chatHistory.push({ role: 'assistant', content: response });
      
      // Send AI response to the chat panel
      this.panel.webview.postMessage({ type: "response", text: response });
    } else if (message.type === "selectFiles") {
      // Open file picker dialog
      const files = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: "Select Files"
      });

      if (files) {
        // Send selected files to webview
        for (const file of files) {
          this.panel.webview.postMessage({ 
            type: "fileSelected", 
            filePath: file.fsPath 
          });
        }
      }
    } else if (message.type === "removeFile") {
      // Handle file removal
      this.panel.webview.postMessage({
        type: "fileRemoved",
        filePath: message.filePath
      });
    } else if (message.type === "refactor") {
      // Get the content of all selected files
      const fileContents = await Promise.all(
        message.files.map(async (filePath: string) => {
          try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            return {
              path: filePath,
              content: document.getText()
            };
          } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
            return null;
          }
        })
      );

      // Filter out any failed file reads
      const validFiles = fileContents.filter(file => file !== null);

      // Create a prompt for refactoring
      const refactorPrompt = `Please refactor the following code to improve its quality, readability, and maintainability. 
      Consider best practices, design patterns, and clean code principles. For each file, provide the complete refactored code.
      Format your response as follows for each file:
      
      File: [filepath]
      Changes:
      [explanation of changes]
      Code:
      \`\`\`
      [refactored code]
      \`\`\`
      
      Files to refactor:
      ${validFiles.map(file => `\nFile: ${file.path}\n\`\`\`\n${file.content}\n\`\`\``).join('\n')}`;

      // Send request to AI for refactoring
      const response = await sendMessageToOpenRouter(refactorPrompt, "");
      
      // Send AI response to the chat panel
      this.panel.webview.postMessage({ 
        type: "response", 
        text: response
      });
    } else if (message.type === "changeModel") {
      // Update the model using the config utility
      await saveModel(message.model);
      // Send confirmation back to webview
      this.panel.webview.postMessage({
        type: 'modelChanged',
        model: message.model
      });

      // Log the model change for debugging
      console.log("Model changed to:", message.model);
    } else if (message.type === "addCustomModel") {
      const newModel: AIModel = {
        id: message.modelId,
        name: message.modelName,
        provider: message.provider,
        isCustom: true
      };
      
      // Check if model already exists
      if (this.customModels.some(m => m.id === newModel.id)) {
        vscode.window.showErrorMessage('A model with this ID already exists.');
        return;
      }

      // Add to custom models
      this.customModels.push(newModel);
      
      // Save to config file
      await this.saveCustomModels();
      
      // Send updated models list to webview
      this.panel.webview.postMessage({
        type: 'modelsUpdated',
        models: [...this.customModels]
      });

      // Show success message and close modal
      vscode.window.showInformationMessage('Custom model added successfully!');
      this.panel.webview.postMessage({
        type: 'closeAddModelModal'
      });
    } else if (message.type === "removeCustomModel") {
      // Remove custom model
      this.customModels = this.customModels.filter(m => m.id !== message.modelId);
      
      // Save to config file
      await this.saveCustomModels();
      
      // Send updated models list to webview
      this.panel.webview.postMessage({
        type: 'modelsUpdated',
        models: [...this.customModels]
      });

      vscode.window.showInformationMessage('Custom model removed successfully!');
      this.panel.webview.postMessage({
        type: 'closeAddModelModal'
      });
    } else if (message.type === "clearChat") {
      // Clear chat history
      this.chatHistory = [];
      this.panel.webview.postMessage({ type: "chatCleared" });
    }
  }

  private getWebviewContent(): string {
    // Only use custom models
    const modelOptions = this.customModels.map(model => 
      `<option value="${model.id}">${model.name} (${model.provider})</option>`
    ).join('');

    const customModelTags = this.customModels.map(model => 
      `<div class="model-tag">
        <span>${model.name} (${model.provider})</span>
        <button onclick="removeCustomModel('${model.id}')">×</button>
      </div>`
    ).join('');

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
        }
        .chat-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          max-width: 100%;
        }
        .messages-container {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
        }
        .message {
          margin-bottom: 12px;
          max-width: 85%;
          padding: 6px 10px;
          border-radius: 4px;
          line-height: 1.4;
          font-size: 13px;
        }
        .user-message {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          margin-left: auto;
        }
        .ai-message {
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          margin-right: auto;
        }
        .ai-message pre {
          background-color: var(--vscode-editor-background);
          padding: 6px;
          border-radius: 3px;
          overflow-x: auto;
          margin: 4px 0;
          font-size: 12px;
          position: relative;
        }
        .copy-button {
          position: absolute;
          top: 4px;
          right: 4px;
          background: none;
          border: 1px solid var(--vscode-button-border);
          color: var(--vscode-button-foreground);
          padding: 2px 6px;
          font-size: 11px;
          border-radius: 3px;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s;
        }
        .ai-message pre:hover .copy-button {
          opacity: 1;
        }
        .ai-message code {
          font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
          font-size: 12px;
          background-color: var(--vscode-editor-background);
          padding: 1px 3px;
          border-radius: 2px;
        }
        .ai-message p {
          margin: 4px 0;
        }
        .ai-message ul, .ai-message ol {
          margin: 4px 0;
          padding-left: 16px;
        }
        .ai-message li {
          margin: 2px 0;
        }
        .ai-message a {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
        }
        .ai-message a:hover {
          text-decoration: underline;
        }
        .ai-message strong {
          color: var(--vscode-editor-foreground);
          font-weight: 600;
        }
        .ai-message em {
          font-style: italic;
        }
        .input-container {
          padding: 8px;
          border-top: 1px solid var(--vscode-panel-border);
          background-color: var(--vscode-editor-background);
        }
        .input-wrapper {
          display: flex;
          gap: 6px;
          max-width: 100%;
          align-items: flex-end;
        }
        .file-selector {
          display: flex;
          gap: 4px;
          margin-bottom: 6px;
          flex-wrap: wrap;
          align-items: center;
          padding: 4px;
          background-color: var(--vscode-editor-background);
          border-radius: 4px;
        }
        .model-selector {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-left: auto;
        }
        .model-selector select {
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
          padding: 2px 6px;
          font-size: 11px;
          cursor: pointer;
          width: 200px;
        }
        .model-selector select option {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px;
        }
        .model-selector select option .delete-btn {
          display: none;
          background: none;
          border: none;
          color: var(--vscode-errorForeground);
          cursor: pointer;
          padding: 2px 4px;
          font-size: 10px;
          border-radius: 2px;
        }
        .model-selector select option:hover .delete-btn {
          display: inline-block;
        }
        .file-tag {
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          display: flex;
          align-items: center;
          gap: 3px;
          color: var(--vscode-descriptionForeground);
          border: 1px solid var(--vscode-panel-border);
        }
        .file-tag button {
          background: none;
          border: none;
          color: var(--vscode-errorForeground);
          cursor: pointer;
          padding: 0;
          font-size: 11px;
          opacity: 0.7;
          width: 14px;
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 2px;
        }
        .file-tag button:hover {
          opacity: 1;
          background-color: var(--vscode-editor-selectionBackground);
        }
        .select-files-btn {
          background: none;
          border: none;
          color: var(--vscode-textLink-foreground);
          cursor: pointer;
          padding: 1px 6px;
          font-size: 11px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .select-files-btn:hover {
          background-color: var(--vscode-editor-selectionBackground);
        }
        .refactor-option {
          display: none;
          background: none;
          border: none;
          color: var(--vscode-textLink-foreground);
          cursor: pointer;
          padding: 1px 6px;
          font-size: 11px;
          border-radius: 3px;
          align-items: center;
          gap: 3px;
          margin-left: 4px;
        }
        .refactor-option.visible {
          display: flex;
        }
        .refactor-option:hover {
          background-color: var(--vscode-editor-selectionBackground);
        }
        textarea {
          flex: 1;
          padding: 6px;
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          resize: none;
          font-family: inherit;
          font-size: 13px;
          line-height: 1.4;
          min-height: 24px;
          max-height: 200px;
        }
        textarea:focus {
          outline: none;
          border-color: var(--vscode-focusBorder);
        }
        button {
          padding: 3px 10px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          transition: background-color 0.2s;
          height: 24px;
          display: flex;
          align-items: center;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        .typing-indicator {
          display: none;
          margin-right: auto;
          padding: 6px 10px;
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          border-radius: 4px;
          color: var(--vscode-descriptionForeground);
          font-size: 13px;
        }
        .typing-indicator.visible {
          display: block;
        }
        .code-change {
          margin: 8px 0;
          padding: 8px;
          background-color: var(--vscode-editor-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          position: relative;
        }
        .code-change-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }
        .code-change-actions {
          position: absolute;
          top: 8px;
          right: 8px;
          display: flex;
          gap: 4px;
        }
        .code-change-actions button {
          padding: 2px 6px;
          font-size: 11px;
          height: 20px;
        }
        .code-change-actions button.accept {
          background-color: var(--vscode-testing-iconPassed);
        }
        .code-change-actions button.reject {
          background-color: var(--vscode-testing-iconFailed);
        }
        .code-change-explanation {
          margin-bottom: 8px;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }
        .add-model-btn {
          background: none;
          border: none;
          color: var(--vscode-textLink-foreground);
          cursor: pointer;
          padding: 1px 6px;
          font-size: 11px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .add-model-btn:hover {
          background-color: var(--vscode-editor-selectionBackground);
        }
        .model-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
        }
        .model-tag {
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          padding: 1px 6px;
          border-radius: 3px;
          font-size: 11px;
          display: flex;
          align-items: center;
          gap: 3px;
          color: var(--vscode-descriptionForeground);
        }
        .model-tag button {
          background: none;
          border: none;
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          padding: 0;
          font-size: 11px;
          opacity: 0.7;
          width: 14px;
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 2px;
        }
        .model-tag button:hover {
          opacity: 1;
          background-color: var(--vscode-editor-selectionBackground);
        }
        .modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          z-index: 1000;
        }
        .modal-content {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background-color: var(--vscode-editor-background);
          padding: 20px;
          border-radius: 4px;
          border: 1px solid var(--vscode-panel-border);
          width: 80%;
          max-width: 400px;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .modal-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--vscode-editor-foreground);
        }
        .modal-close {
          background: none;
          border: none;
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          padding: 4px;
          font-size: 16px;
        }
        .form-group {
          margin-bottom: 12px;
        }
        .form-group label {
          display: block;
          margin-bottom: 4px;
          font-size: 12px;
          color: var(--vscode-descriptionForeground);
        }
        .form-group input {
          width: 100%;
          padding: 6px;
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          font-size: 12px;
        }
        .form-group input:focus {
          outline: none;
          border-color: var(--vscode-focusBorder);
        }
        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 20px;
        }
        .modal-footer button {
          padding: 4px 12px;
          font-size: 12px;
        }
        .modal-footer button.cancel {
          background: none;
          border: 1px solid var(--vscode-button-border);
          color: var(--vscode-button-foreground);
        }
        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          border-bottom: 1px solid var(--vscode-panel-border);
          background-color: var(--vscode-editor-background);
        }
        .clear-chat-btn {
          background: none;
          border: none;
          color: var(--vscode-textLink-foreground);
          cursor: pointer;
          padding: 4px 8px;
          font-size: 11px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .clear-chat-btn:hover {
          background-color: var(--vscode-editor-selectionBackground);
        }
      </style>
    </head>
    <body>
      <div class="chat-container">
        <div class="chat-header">
          <span>Chat History</span>
          <button class="clear-chat-btn" onclick="clearChat()">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            Clear Chat
          </button>
        </div>
        <div class="messages-container" id="messages"></div>
        <div class="typing-indicator" id="typingIndicator">AI is typing...</div>
        <div class="input-container">
          <div class="file-selector" id="fileSelector">
            <button class="select-files-btn" onclick="selectFiles()">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6 2V10M2 6H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              Add files
            </button>
            <button class="refactor-option" id="refactorBtn" onclick="refactorCode()">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 6L4 4M4 4L6 6M4 4V8M8 6L10 8M10 8L8 10M10 8V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              Refactor
            </button>
            <div class="model-selector">
              <select id="modelSelect" onchange="changeModel()">
                ${modelOptions}
              </select>
              <button class="add-model-btn" onclick="showAddModelDialog()">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 2V10M2 6H10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                Add Model
              </button>
            </div>
          </div>
          <div class="model-tags" id="customModelTags">
            ${customModelTags}
          </div>
          <div class="input-wrapper">
            <textarea 
              id="userInput" 
              placeholder="Ask AI anything..." 
              rows="1"
              onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }"
            ></textarea>
            <button onclick="sendMessage()">Send</button>
          </div>
        </div>
      </div>
      <div id="addModelModal" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <span class="modal-title">Add Custom Model</span>
            <button class="modal-close" onclick="closeAddModelModal()">×</button>
          </div>
          <div class="form-group">
            <label for="modelId">OpenRouter Model ID</label>
            <input type="text" id="modelId" placeholder="e.g., openai/gpt-4">
          </div>
          <div class="form-group">
            <label for="modelName">Display Name</label>
            <input type="text" id="modelName" placeholder="e.g., GPT-4">
          </div>
          <div class="form-group">
            <label for="provider">Provider</label>
            <input type="text" id="provider" placeholder="e.g., OpenAI">
          </div>
          <div class="modal-footer">
            <button class="cancel" onclick="closeAddModelModal()">Cancel</button>
            <button onclick="submitNewModel()">Add Model</button>
          </div>
        </div>
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        const messagesContainer = document.getElementById('messages');
        const userInput = document.getElementById('userInput');
        const typingIndicator = document.getElementById('typingIndicator');
        const fileSelector = document.getElementById('fileSelector');
        const refactorBtn = document.getElementById('refactorBtn');
        const modelSelect = document.getElementById('modelSelect');
        let selectedFiles = new Set();

        // Configure marked options
        marked.setOptions({
          breaks: true,
          gfm: true,
          headerIds: false,
          mangle: false
        });

        function showAddModelDialog() {
          const modal = document.getElementById('addModelModal');
          modal.style.display = 'block';
        }

        function closeAddModelModal() {
          const modal = document.getElementById('addModelModal');
          modal.style.display = 'none';
          // Clear inputs
          document.getElementById('modelId').value = '';
          document.getElementById('modelName').value = '';
          document.getElementById('provider').value = '';
        }

        function submitNewModel() {
          const modelId = document.getElementById('modelId').value.trim();
          const modelName = document.getElementById('modelName').value.trim();
          const provider = document.getElementById('provider').value.trim();

          if (!modelId || !modelName || !provider) {
            // Show error message
            vscode.postMessage({
              type: 'error',
              message: 'Please fill in all fields'
            });
            return;
          }

          vscode.postMessage({
            type: 'addCustomModel',
            modelId,
            modelName,
            provider
          });

          closeAddModelModal();
        }

        // Close modal when clicking outside
        window.onclick = function(event) {
          const modal = document.getElementById('addModelModal');
          if (event.target === modal) {
            closeAddModelModal();
          }
        }

        function changeModel() {
          const selectedModel = modelSelect.value;
          vscode.postMessage({
            type: 'changeModel',
            model: selectedModel
          });
        }

        function removeCustomModel(modelId) {
          vscode.postMessage({
            type: 'removeCustomModel',
            modelId: modelId
          });
        }

        // Initialize model from state
        const state = vscode.getState();
        if (state && state.model) {
          modelSelect.value = state.model;
        }

        function selectFiles() {
          vscode.postMessage({ type: 'selectFiles' });
        }

        function refactorCode() {
          if (selectedFiles.size === 0) return;
          vscode.postMessage({ 
            type: 'refactor',
            files: Array.from(selectedFiles)
          });
        }

        function updateRefactorButton() {
          refactorBtn.classList.toggle('visible', selectedFiles.size > 0);
        }

        function addFileTag(filePath, isDefault = false) {
          if (selectedFiles.has(filePath)) return;
          selectedFiles.add(filePath);
          
          const tag = document.createElement('div');
          tag.className = 'file-tag';
          tag.innerHTML = \`
            <span>\${filePath}</span>
            <button onclick="removeFile('\${filePath}', \${isDefault})" title="Remove file">×</button>
          \`;
          fileSelector.insertBefore(tag, fileSelector.firstChild);
          updateRefactorButton();
        }

        function removeFile(filePath, isDefault = false) {
          selectedFiles.delete(filePath);
          const tags = fileSelector.getElementsByClassName('file-tag');
          for (let tag of tags) {
            if (tag.querySelector('span').textContent === filePath) {
              tag.remove();
              break;
            }
          }
          updateRefactorButton();
          
          // Notify the extension about file removal
          vscode.postMessage({
            type: 'removeFile',
            filePath: filePath
          });
        }

        function addMessage(text, isUser) {
          const messageDiv = document.createElement('div');
          messageDiv.className = \`message \${isUser ? 'user-message' : 'ai-message'}\`;
          
          if (isUser) {
            messageDiv.textContent = text;
          } else {
            messageDiv.innerHTML += marked.parse(text);
            
            // Add copy buttons to code blocks
            messageDiv.querySelectorAll('pre code').forEach((codeBlock) => {
              const copyButton = document.createElement('button');
              copyButton.className = 'copy-button';
              copyButton.textContent = 'Copy';
              copyButton.onclick = () => {
                navigator.clipboard.writeText(codeBlock.textContent);
                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                  copyButton.textContent = 'Copy';
                }, 2000);
              };
              codeBlock.parentElement.appendChild(copyButton);
            });
          }
          
          messagesContainer.appendChild(messageDiv);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function sendMessage() {
          const input = userInput.value.trim();
          if (!input) return;
          
          addMessage(input, true);
          userInput.value = '';
          typingIndicator.classList.add('visible');
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
          
          vscode.postMessage({ 
            type: 'chat', 
            text: input,
            files: Array.from(selectedFiles)
          });
        }

        function clearChat() {
          vscode.postMessage({ type: 'clearChat' });
        }

        window.addEventListener('message', event => {
          const message = event.data;
          if (message.type === 'response') {
            typingIndicator.classList.remove('visible');
            addMessage(message.text, false);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          } else if (message.type === 'fileSelected') {
            addFileTag(message.filePath, message.isDefault);
          } else if (message.type === 'fileRemoved') {
            removeFile(message.filePath);
          } else if (message.type === 'modelsUpdated') {
            // Update model select options
            modelSelect.innerHTML = message.models.map(model => 
              \`<option value="\${model.id}">\${model.name} (\${model.provider})</option>\`
            ).join('');
            
            // Update custom model tags
            const customModelTags = message.models
              .filter(model => model.isCustom)
              .map(model => \`
                <div class="model-tag">
                  <span>\${model.name} (\${model.provider})</span>
                  <button onclick="removeCustomModel('\${model.id}')">×</button>
                </div>
              \`).join('');
            document.getElementById('customModelTags').innerHTML = customModelTags;
          } else if (message.type === 'closeAddModelModal') {
            closeAddModelModal();
          } else if (message.type === 'chatCleared') {
            messagesContainer.innerHTML = '';
          }
        });

        // Auto-resize textarea
        userInput.addEventListener('input', function() {
          this.style.height = 'auto';
          this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        });
      </script>
    </body>
    </html>`;
  }
}
