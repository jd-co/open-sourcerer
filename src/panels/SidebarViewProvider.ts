import * as vscode from "vscode";
import * as fs from 'fs';
import * as path from 'path';
import { AIModel } from "../constants/models";
import { sendMessageToOpenRouter } from "../utils/api";
import { SYSTEM_PROMPTS } from "../prompts";

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'openSourcerer.sidebarView';
  private _view?: vscode.WebviewView;
  private readonly context: vscode.ExtensionContext;
  private customModels: AIModel[] = [];
  private readonly customModelsPath: string;
  private chatHistory: { role: 'user' | 'assistant', content: string }[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.customModelsPath = path.join(context.extensionPath, 'src', 'config', 'customModels.json');
    
    // Load custom models from config file
    this.loadCustomModels();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'media'))
      ]
    };

    webviewView.webview.html = this.getWebviewContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(this.handleMessage, this);

    // Load and send initial settings to webview
    this.loadSettings();
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

  private loadSettings() {
    if (!this._view) return;

    // Load API settings
    const apiKey = this.context.globalState.get('apiKey', '');
    const apiUrl = this.context.globalState.get('apiUrl', '');
    
    // Send settings to webview
    this._view.webview.postMessage({
      type: 'settingsLoaded',
      apiKey,
      apiUrl,
      models: this.customModels,
      showSettings: !apiKey || !apiUrl // Automatically show settings if API key or URL is missing
    });
  }

  private async saveSettings(apiKey: string, apiUrl: string) {
    if (!this._view) return;

    // Save API settings
    await this.context.globalState.update('apiKey', apiKey);
    await this.context.globalState.update('apiUrl', apiUrl);
    
    // Confirm to webview
    this._view.webview.postMessage({
      type: 'settingsSaved'
    });
  }

  private async handleMessage(message: any) {
    if (!this._view) return;

    switch (message.type) {
      case 'newChat':
        // Clear chat history and notify UI
        this.chatHistory = [];
        this._view.webview.postMessage({ type: "chatCleared" });
        break;
        
      case 'saveSettings':
        await this.saveSettings(message.apiKey, message.apiUrl);
        break;
        
      case 'addModel':
        const newModel: AIModel = {
          id: message.modelId,
          name: message.modelName,
          provider: message.provider || 'Custom',
          isCustom: true
        };
        
        // Check if model already exists
        if (this.customModels.some(m => m.id === newModel.id)) {
          this._view.webview.postMessage({
            type: 'error',
            message: 'A model with this ID already exists.'
          });
          return;
        }

        // Add to custom models
        this.customModels.push(newModel);
        
        // Save to config file
        await this.saveCustomModels();
        
        // Send updated models list to webview
        this._view.webview.postMessage({
          type: 'modelsUpdated',
          models: this.customModels
        });
        break;
        
      case 'deleteModel':
        // Remove model
        this.customModels = this.customModels.filter(m => m.id !== message.modelId);
        
        // Save to config file
        await this.saveCustomModels();
        
        // Send updated models list to webview
        this._view.webview.postMessage({
          type: 'modelsUpdated',
          models: this.customModels
        });
        break;
        
      case 'sendMessage':
        // Process chat message
        await this.processChatMessage(message.text, message.modelId);
        break;
    }
  }

  private async processChatMessage(text: string, modelId: string) {
    if (!this._view) return;
    
    // Check if API key and URL are configured
    const apiKey = this.context.globalState.get('apiKey', '');
    const apiUrl = this.context.globalState.get('apiUrl', '');
    
    if (!apiKey || !apiUrl) {
      this._view.webview.postMessage({
        type: 'error',
        message: 'Please configure your API key and URL in settings first'
      });
      return;
    }
    
    // Add user message to chat history
    this.chatHistory.push({ role: 'user', content: text });

    try {
      const prompt = SYSTEM_PROMPTS.GENERAL_CHAT_ASSISTANT + `user query: ${text}`;
      // Send request to AI with code context and chat history
      const response = await sendMessageToOpenRouter(prompt,'', this.chatHistory);
      
      // Add AI response to chat history
      this.chatHistory.push({ role: 'assistant', content: response });
      
      // Send response back to webview
      this._view.webview.postMessage({
        type: 'chatResponse',
        text: response
      });
    } catch (error) {
      console.error('Error sending message to API:', error);
      
      // Inform user of the error
      this._view.webview.postMessage({
        type: 'error',
        message: 'Error communicating with the API. Please check your settings and connection.'
      });
    }
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const logoPath = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'icon.png'))
    );

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SuperMaven</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background-color: var(--vscode-editor-background);
          color: var(--vscode-editor-foreground);
          height: 100vh;
          overflow: hidden;
        }
        
        /* Sidebar Styles */
        .sidebar {
          display: flex;
          flex-direction: column;
          height: 100vh;
          width: 100%;
          background-color: var(--vscode-sideBar-background);
          color: var(--vscode-sideBar-foreground);
        }
        
        /* Header */
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .logo {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .logo img {
          height: 24px;
          width: auto;
        }
        
        .logo span {
          font-size: 16px;
          font-weight: 500;
        }
        
        .header-actions {
          display: flex;
          gap: 8px;
        }
        
        .icon-btn {
          background: none;
          border: none;
          color: var(--vscode-editor-foreground);
          cursor: pointer;
          font-size: 16px;
          padding: 4px 8px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .icon-btn:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        
        /* Settings Panel */
        .settings-panel {
          padding: 16px;
          border-bottom: 1px solid var(--vscode-panel-border);
          display: none;
        }
        
        .settings-panel.visible {
          display: block;
        }
        
        .settings-panel h3 {
          margin-top: 0;
          margin-bottom: 12px;
          font-size: 14px;
          font-weight: 500;
        }
        
        .settings-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .settings-form input {
          padding: 6px 8px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
          font-size: 12px;
        }
        
        .settings-form button {
          padding: 6px 12px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
          transition: background-color 0.2s;
        }
        
        .settings-form button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        
        .welcome-message {
          margin-bottom: 12px;
          padding: 8px;
          background-color: var(--vscode-editorInfo-background);
          border-radius: 4px;
          font-size: 12px;
          line-height: 1.4;
        }
        
        .model-section {
          margin-top: 16px;
        }
        
        .model-section h4 {
          margin: 0 0 8px 0;
          font-size: 13px;
          font-weight: 400;
        }
        
        .model-add {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }
        
        .model-add input {
          flex: 1;
        }
        
        .models-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 150px;
          overflow-y: auto;
        }
        
        .model-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 8px;
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          border-radius: 3px;
          font-size: 12px;
        }
        
        .model-item button {
          background: none;
          border: none;
          color: var(--vscode-errorForeground);
          cursor: pointer;
          padding: 0;
          font-size: 14px;
          opacity: 0.8;
        }
        
        .model-item button:hover {
          opacity: 1;
        }
        
        /* Chat Section */
        .chat-section {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
        }
        
        .model-selector {
          padding: 10px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .model-selector select {
          width: 100%;
          padding: 6px 8px;
          background-color: var(--vscode-dropdown-background);
          color: var(--vscode-dropdown-foreground);
          border: 1px solid var(--vscode-dropdown-border);
          border-radius: 3px;
          font-size: 12px;
        }
        
        .chat-container {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        
        .message {
          padding: 8px 10px;
          border-radius: 4px;
          max-width: 85%;
          word-break: break-word;
          font-size: 12px;
          line-height: 1.4;
        }
        
        .user-message {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          align-self: flex-end;
        }
        
        .bot-message {
          background-color: var(--vscode-editor-inactiveSelectionBackground);
          color: var(--vscode-editor-foreground);
          align-self: flex-start;
        }
        
        .initial-message {
          align-self: center;
          text-align: center;
          color: var(--vscode-descriptionForeground);
          margin: 20px 0;
          padding: 16px;
          max-width: 90%;
        }
        
        .chat-input-container {
          padding: 10px;
          border-top: 1px solid var(--vscode-panel-border);
        }
        
        .input-wrapper {
          display: flex;
          gap: 8px;
        }
        
        textarea {
          flex: 1;
          resize: none;
          height: 32px;
          max-height: 100px;
          padding: 6px 8px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 3px;
          font-size: 12px;
          line-height: 1.4;
          overflow: auto;
        }
        
        .send-btn {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: 3px;
          padding: 6px 10px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .send-btn:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
      </style>
    </head>
    <body>
      <div class="sidebar">
        <!-- Header -->
        <div class="header">
          <div class="logo">
            <img src="${logoPath}" alt="SuperMaven">
            <span>supermaven</span>
          </div>
          <div class="header-actions">
            <button id="settingsBtn" class="icon-btn" title="Settings">⚙️</button>
            <button id="newChatBtn" class="icon-btn" title="New Chat">+</button>
          </div>
        </div>
        
        <!-- Settings Panel -->
        <div id="settingsPanel" class="settings-panel">
          <h3>Settings</h3>
          <div id="welcomeMessage" class="welcome-message" style="display: none;">
            Welcome to SuperMaven! Please configure your API key and URL to get started.
          </div>
          <div class="settings-form">
            <input type="password" id="apiKey" placeholder="API Key">
            <input type="text" id="apiUrl" placeholder="API URL">
            <button id="saveSettingsBtn">Save Settings</button>
            
            <div class="model-section">
              <h4>Models</h4>
              <div class="model-add">
                <input type="text" id="modelName" placeholder="Model Name">
                <input type="text" id="modelId" placeholder="Model ID">
                <button id="addModelBtn">Add</button>
              </div>
              <div id="modelsList" class="models-list">
                <!-- Models will be added here dynamically -->
              </div>
            </div>
          </div>
        </div>
        
        <!-- Chat Section -->
        <div class="chat-section">
          <div class="model-selector">
            <select id="modelSelect">
              <option value="">Select a model</option>
              <!-- Models will be added here dynamically -->
            </select>
          </div>
          
          <div id="chatContainer" class="chat-container">
            <!-- Initial welcome message -->
            <div class="initial-message">
              Welcome to SuperMaven! Select a model from the dropdown above and start chatting.
            </div>
            <!-- Chat messages will be added here dynamically -->
          </div>
          
          <div class="chat-input-container">
            <form id="chatForm">
              <div class="input-wrapper">
                <textarea 
                  id="messageInput" 
                  placeholder="Type your message..." 
                  rows="1"
                  autofocus
                ></textarea>
                <button type="submit" class="send-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
      
      <script>
        (function() {
          const vscode = acquireVsCodeApi();
          
          // DOM elements
          const settingsBtn = document.getElementById('settingsBtn');
          const settingsPanel = document.getElementById('settingsPanel');
          const welcomeMessage = document.getElementById('welcomeMessage');
          const newChatBtn = document.getElementById('newChatBtn');
          const apiKeyInput = document.getElementById('apiKey');
          const apiUrlInput = document.getElementById('apiUrl');
          const saveSettingsBtn = document.getElementById('saveSettingsBtn');
          const modelNameInput = document.getElementById('modelName');
          const modelIdInput = document.getElementById('modelId');
          const addModelBtn = document.getElementById('addModelBtn');
          const modelsList = document.getElementById('modelsList');
          const modelSelect = document.getElementById('modelSelect');
          const chatContainer = document.getElementById('chatContainer');
          const chatForm = document.getElementById('chatForm');
          const messageInput = document.getElementById('messageInput');
          
          // State
          let models = [];
          let selectedModel = '';
          let apiConfigured = false;
          
          // Event listeners
          settingsBtn.addEventListener('click', toggleSettings);
          newChatBtn.addEventListener('click', createNewChat);
          saveSettingsBtn.addEventListener('click', saveSettings);
          addModelBtn.addEventListener('click', addModel);
          chatForm.addEventListener('submit', sendMessage);
          modelSelect.addEventListener('change', selectModel);
          
          // Auto-resize textarea
          messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
          });
          
          // Functions
          function toggleSettings() {
            settingsPanel.classList.toggle('visible');
          }
          
          function createNewChat() {
            // Clear chat history
            clearChat();
            
            // Notify extension
            vscode.postMessage({
              type: 'newChat'
            });
          }
          
          function clearChat() {
            // Reset chat container with just the welcome message
            chatContainer.innerHTML = '<div class="initial-message">Welcome to SuperMaven! Select a model from the dropdown above and start chatting.</div>';
          }
          
          function saveSettings() {
            const apiKey = apiKeyInput.value.trim();
            const apiUrl = apiUrlInput.value.trim();
            
            if (!apiKey || !apiUrl) {
              alert('Please enter both API Key and API URL');
              return;
            }
            
            // Notify extension
            vscode.postMessage({
              type: 'saveSettings',
              apiKey,
              apiUrl
            });
            
            apiConfigured = true;
          }
          
          function addModel() {
            const modelName = modelNameInput.value.trim();
            const modelId = modelIdInput.value.trim();
            
            if (!modelName || !modelId) {
              // Show error
              alert('Please enter both model name and ID');
              return;
            }
            
            // Notify extension
            vscode.postMessage({
              type: 'addModel',
              modelName,
              modelId
            });
            
            // Clear inputs
            modelNameInput.value = '';
            modelIdInput.value = '';
          }
          
          function deleteModel(modelId) {
            // Notify extension
            vscode.postMessage({
              type: 'deleteModel',
              modelId
            });
          }
          
          function updateModelsList(models) {
            // Clear current lists
            modelsList.innerHTML = '';
            
            // Populate model selector
            let modelOptions = '<option value="">Select a model</option>';
            
            // Add models to both lists
            models.forEach(model => {
              // Add to models list in settings
              const modelItem = document.createElement('div');
              modelItem.className = 'model-item';
              modelItem.innerHTML = \`
                <span>\${model.name}</span>
                <button onclick="deleteModel('\${model.id}')">×</button>
              \`;
              modelsList.appendChild(modelItem);
              
              // Add to selector
              modelOptions += \`<option value="\${model.id}">\${model.name}</option>\`;
            });
            
            modelSelect.innerHTML = modelOptions;
            
            // Restore selected model if possible
            if (selectedModel && models.some(m => m.id === selectedModel)) {
              modelSelect.value = selectedModel;
            }
          }
          
          function selectModel() {
            selectedModel = modelSelect.value;
          }
          
          function sendMessage(event) {
            event.preventDefault();
            
            const message = messageInput.value.trim();
            if (!message) return;
            
            if (!selectedModel) {
              alert('Please select a model first');
              return;
            }
            
            if (!apiConfigured) {
              alert('Please configure your API key and URL in settings first');
              settingsPanel.classList.add('visible');
              welcomeMessage.style.display = 'block';
              return;
            }
            
            // Remove initial message if present
            const initialMessage = chatContainer.querySelector('.initial-message');
            if (initialMessage) {
              initialMessage.remove();
            }
            
            // Add message to chat
            addChatMessage(message, true);
            
            // Clear input
            messageInput.value = '';
            messageInput.style.height = 'auto';
            
            // Notify extension
            vscode.postMessage({
              type: 'sendMessage',
              text: message,
              modelId: selectedModel
            });
          }
          
          function addChatMessage(text, isUser) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${isUser ? 'user-message' : 'bot-message'}\`;
            messageDiv.textContent = text;
            
            chatContainer.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
          
          // Function to delete model (needs to be global for onclick to work)
          window.deleteModel = deleteModel;
          
          // Handle messages from extension
          window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
              case 'settingsLoaded':
                apiKeyInput.value = message.apiKey || '';
                apiUrlInput.value = message.apiUrl || '';
                models = message.models || [];
                updateModelsList(models);
                
                // Check if API is configured
                apiConfigured = !!(message.apiKey && message.apiUrl);
                
                // Show settings panel if API is not configured
                if (message.showSettings) {
                  settingsPanel.classList.add('visible');
                  welcomeMessage.style.display = 'block';
                }
                break;
                
              case 'settingsSaved':
                // Confirm settings saved
                alert('Settings saved successfully');
                settingsPanel.classList.remove('visible');
                break;
                
              case 'modelsUpdated':
                models = message.models || [];
                updateModelsList(models);
                break;
                
              case 'chatResponse':
                // Add bot message to chat
                addChatMessage(message.text, false);
                break;
                
              case 'chatCleared':
                // Clear chat container
                clearChat();
                break;
                
              case 'error':
                // Show error message
                alert(message.message);
                break;
            }
          });
        })();
      </script>
    </body>
    </html>`;
  }
} 