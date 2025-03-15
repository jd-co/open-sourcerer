// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatViewProvider } from "./panels/ChatViewProvider";
import { QuickFixProvider } from "./providers/QuickFixProvider";
import { sendMessageToOpenRouter } from "./utils/api";
import { triggerInlineChat, registerInlineChatCommands } from './commands/inlineChat';
import { SYSTEM_PROMPTS } from './prompts';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
// export function activate(context: vscode.ExtensionContext) {

// 	// Use the console to output diagnostic information (console.log) and errors (console.error)




export function activate(context: vscode.ExtensionContext) {
	console.log("Open Sourcerer extension activated!");
  
	// Register inline chat commands
	registerInlineChatCommands(context);
  
	context.subscriptions.push(
	  vscode.commands.registerCommand("openSourcerer.fixWithAI", async (document: vscode.TextDocument, range: vscode.Range) => {
		console.log("fixWithAI command triggered!");
  
		if (!document || !range) {
		  vscode.window.showErrorMessage("No valid range found for AI fix.");
		  return;
		}
  
		const selectedText = document.getText(range);
		if (!selectedText) {
		  vscode.window.showErrorMessage("No code selected for fixing.");
		  return;
		}
  
		vscode.window.showInformationMessage("Fetching AI Fix...");
  
		try {
		  const fixSuggestion = await sendMessageToOpenRouter(`You are an AI assistant fixing JavaScript/TypeScript code errors.
					Take the following code, fix only the syntax/logical issues, and return only the corrected code without explanations.
					Code:
					\`\`\`
					${selectedText}
					\`\`\` 
					response should be the code itself dont add any extra explanation or language etc.
					`);
		  const editor = vscode.window.activeTextEditor;
		  if (!editor) {
			vscode.window.showErrorMessage("No active editor.");
			return;
		  }
		  editor.edit(editBuilder => {
			editBuilder.replace(editor.selection, fixSuggestion.replace(/^```[\w]*\n/, "").replace(/\n```$/, ""));
		  });
  
		  vscode.window.showInformationMessage("AI Fix Applied!");
		} catch (error) {
		  console.error("AI Fix failed:", error);
		  vscode.window.showErrorMessage("Failed to fetch AI Fix.");
		}
	  })
	);
  
	// Register Quick Fix Provider
	context.subscriptions.push(
	  vscode.languages.registerCodeActionsProvider(
		{ scheme: "file", language: "javascript" },
		new QuickFixProvider(),
		{ providedCodeActionKinds: QuickFixProvider.providedCodeActionKinds }
	  )
	);
// 	let inlineChatCommand = vscode.commands.registerCommand("openSourcerer.inlineChat", async () => {
// 		const editor = vscode.window.activeTextEditor;
// 		if (!editor) {
// 		  vscode.window.showErrorMessage("No active editor found!");
// 		  return;
// 		}
		
// 		const fileExtension = editor.document.fileName.split('.').pop() ?? "plaintext";
// 		const selection = editor.selection;
// 		const selectedText = editor.document.getText(selection);
	
// 		const userQuery = await vscode.window.showInputBox({
// 		  prompt: "Ask AI about the selected code...",
// 		  placeHolder: "Optimize / Fix bug / Explain",
// 		});
	
// 		if (!userQuery) return;
// 		const prompt = SYSTEM_PROMPTS.INLINE_CODE_ASSISTANT+ `file extesion: ${fileExtension}` + `Users query: ${userQuery}`
// 		const aiResponse = await sendMessageToOpenRouter(prompt, selectedText);
// 		console.log('ai responswe', aiResponse)
// 		if (!aiResponse) {
// 		  vscode.window.showErrorMessage("Failed to fetch AI response.");
// 		  return;
// 		}
// 		const codeMatch = RegExp(/```(?:\w+)?\n([\s\S]+?)\n```/).exec(aiResponse);
		
// 		const generatedCode = codeMatch ? codeMatch[0].replace(/^```[\w]*\n/, "").replace(/\n```$/, "") : aiResponse.trim()
// 		showInlineAIResponse(editor,generatedCode);
	
//   });


// 	// **Updated Inline Chat Command with AI Preview**
// 	let inlineChatCommand = vscode.commands.registerCommand("openSourcerer.inlineChat", async () => {
// 		const editor = vscode.window.activeTextEditor;
// 		if (!editor) {
// 			vscode.window.showErrorMessage("No active editor found!");
// 			return;
// 		}

// 		const fileExtension = editor.document.fileName.split('.').pop() ?? "plaintext";
// 		const selection = editor.selection;
// 		const selectedText = editor.document.getText(selection);

// 		const userQuery = await vscode.window.showInputBox({
// 			prompt: "Ask AI about the selected code...",
// 			placeHolder: "Optimize / Fix bug / Explain",
// 		});

// 		if (!userQuery) return;
// 		const prompt = SYSTEM_PROMPTS.INLINE_CODE_ASSISTANT + `file extension: ${fileExtension}` + `User's query: ${userQuery}`;
// 		const aiResponse = await sendMessageToOpenRouter(prompt, selectedText);
// 		console.log('AI Response:', aiResponse);

// 		if (!aiResponse) {
// 			vscode.window.showErrorMessage("Failed to fetch AI response.");
// 			return;
// 		}

// 		const codeMatch = RegExp(/```(?:\w+)?\n([\s\S]+?)\n```/).exec(aiResponse);
// 		const generatedCode = codeMatch ? codeMatch[1].replace(/^```[\w]*\n/, "").replace(/\n```$/, "") : aiResponse.trim();

// 		// **NEW: Inline Preview + Accept/Reject Buttons**
// 		showInlineSuggestionWithActions(editor, generatedCode);
// 	});

//   context.subscriptions.push(inlineChatCommand);

// context.subscriptions.push(
// 	vscode.commands.registerCommand("openSourcerer.inlineChat", async () => {
// 		await triggerInlineChat();
// 	})
// );

// Register the command to open the chat panel
let disposable = vscode.commands.registerCommand("openSourcerer.chatWindow", () => {
  ChatViewProvider.showChatPanel(context);
});


context.subscriptions.push(disposable);
}
// This method is called when your extension is deactivated
export function deactivate() {}