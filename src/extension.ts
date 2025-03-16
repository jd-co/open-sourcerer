// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ChatViewProvider } from "./panels/ChatViewProvider";
import { QuickFixProvider } from "./providers/QuickFixProvider";
import { getAICompletion, sendMessageToOpenRouter } from "./utils/api";
import { registerInlineChatCommands } from './commands/inlineChat';
import { SYSTEM_PROMPTS } from './prompts';

let timeout: NodeJS.Timeout | null = null;
// Import the new SidebarViewProvider
import { SidebarViewProvider } from './panels/SidebarViewProvider';

export function activate(context: vscode.ExtensionContext) {
	console.log("Open Sourcerer extension activated!");

	// Register the sidebar view provider
	const sidebarProvider = new SidebarViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarViewProvider.viewType,
			sidebarProvider,
			{
				webviewOptions: {
					retainContextWhenHidden: true
				}
			}
		)
	);
  
	// Register inline chat commands
	registerInlineChatCommands(context);
  
	// context.subscriptions.push(
	//   vscode.commands.registerCommand("openSourcerer.fixWithAI", async (document: vscode.TextDocument, range: vscode.Range) => {
	// 	console.log("fixWithAI command triggered!");
  
	// 	if (!document || !range) {
	// 	  vscode.window.showErrorMessage("No valid range found for AI fix.");
	// 	  return;
	// 	}
  
	// 	const selectedText = document.getText(range);
	// 	if (!selectedText) {
	// 	  vscode.window.showErrorMessage("No code selected for fixing.");
	// 	  return;
	// 	}
  
	// 	vscode.window.showInformationMessage("Fetching AI Fix...");
  
	// 	try {
	// 	  // Get more context to provide to the AI
	// 	  const fileName = document.fileName.split(/[/\\]/).pop() || "";
	// 	  const fileExtension = fileName.split('.').pop() || "";
	// 	  const language = document.languageId;
		  
	// 	  // Get the entire file content for context
	// 	  const entireFileContent = document.getText();
		  
	// 	  // Calculate the selected code's position in the file
	// 	  const startLine = document.positionAt(document.offsetAt(range.start)).line + 1;
	// 	  const endLine = document.positionAt(document.offsetAt(range.end)).line + 1;
		  
	// 	  const fixSuggestion = await sendMessageToOpenRouter(`You are an AI assistant fixing code errors and improving code quality.

	// 				I need you to fix or improve code in a ${language} file named "${fileName}".
					
	// 				FULL FILE CONTEXT (for reference only):
	// 				\`\`\`${language}
	// 				${entireFileContent}
	// 				\`\`\`
					
	// 				FIX THIS SPECIFIC CODE (lines ${startLine}-${endLine}):
	// 				\`\`\`${language}
	// 				${selectedText}
	// 				\`\`\`
					
	// 				Analyze the code in the context of the entire file. Fix any syntax errors, logical issues, or improve the code quality.
	// 				Return ONLY the fixed/improved version of the SPECIFIC CODE section without explanations.
	// 				DO NOT return the entire file, only return the fixed portion that should replace the selected code.
					
	// 				Response format:
	// 				\`\`\`
	// 				[your fixed code goes here]
	// 				\`\`\`
	// 				`);
	// 	  const editor = vscode.window.activeTextEditor;
	// 	  if (!editor) {
	// 		vscode.window.showErrorMessage("No active editor.");
	// 		return;
	// 	  }
	// 	  editor.edit(editBuilder => {
	// 		// Improved regex to handle various code block formats
	// 		const cleanedCode = fixSuggestion
	// 		  .replace(/^```[\w]*\r?\n/g, '') // Remove opening code fence with optional language
	// 		  .replace(/\r?\n```$/g, '')      // Remove closing code fence
	// 		  .trim();                        // Trim any extra whitespace
	// 		editBuilder.replace(editor.selection, cleanedCode);
	// 	  });
  
	// 	  vscode.window.showInformationMessage("AI Fix Applied!");
	// 	} catch (error) {
	// 	  console.error("AI Fix failed:", error);
	// 	  vscode.window.showErrorMessage("Failed to fetch AI Fix.");
	// 	}
	//   })
	// );
  
	// New command to auto-detect and fix errors with AI
	context.subscriptions.push(
	  vscode.commands.registerCommand("openSourcerer.fixWithAI", async () => {
		console.log("fixWithAI command triggered!");
  
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
		  vscode.window.showErrorMessage("No active editor.");
		  return;
		}
  
		const document = editor.document;
		
		// Get all diagnostics (errors/warnings) for the current document
		const diagnostics = vscode.languages.getDiagnostics(document.uri);
		
		if (diagnostics.length === 0) {
		  vscode.window.showInformationMessage("No errors or warnings detected in the current file.");
		  return;
		}
		
		// Group diagnostics by line to handle multiple errors in the same area
		const lineToErrors = new Map<number, vscode.Diagnostic[]>();
		
		diagnostics.forEach(diagnostic => {
		  const startLine = diagnostic.range.start.line;
		  if (!lineToErrors.has(startLine)) {
			lineToErrors.set(startLine, []);
		  }
		  lineToErrors.get(startLine)?.push(diagnostic);
		});
		
		// Sort diagnostics by severity (error first, then warning)
		const sortedLines = Array.from(lineToErrors.entries())
		  .sort((a, b) => {
			const aHighestSeverity = Math.min(...a[1].map(d => d.severity));
			const bHighestSeverity = Math.min(...b[1].map(d => d.severity));
			return aHighestSeverity - bHighestSeverity;
		  })
		  .map(entry => entry[0]);
		
		if (sortedLines.length === 0) {
		  vscode.window.showInformationMessage("No actionable errors found.");
		  return;
		}
		
		// Get the line with the most severe error
		const targetLine = sortedLines[0];
		const targetErrors = lineToErrors.get(targetLine) || [];
		
		// Find a reasonable context for the error (try to find function or block boundaries)
		let startLine = targetLine;
		let endLine = targetLine;
		
		// // Look up to find function start or reasonable context start (max 10 lines)
		// for (let i = targetLine; i >= Math.max(0, targetLine - 10); i--) {
		//   const lineText = document.lineAt(i).text;
		//   if (lineText.match(/^\s|^\s*\w+\s*\(\s*.*\s*\)\s*{|^\s*{/)) {
		// 	startLine = i;
		// 	break;
		//   }
		// }
		
		// // Look down to find function end or reasonable context end (max 10 lines)
		// for (let i = targetLine; i < Math.min(document.lineCount, targetLine + 10); i++) {
		//   const lineText = document.lineAt(i).text;
		//   if (lineText.match(/^\s*}/) && i > endLine) {
		// 	endLine = i;
		// 	break;
		//   }
		// }
		
		// Create a range for the error context
		const errorRange = new vscode.Range(
		  new vscode.Position(startLine, 0),
		  new vscode.Position(endLine, document.lineAt(endLine).text.length)
		);
		
		// Store the original selection to determine if we should restore it later
		const originalSelection = editor.selection;
		const hasOriginalSelection = !originalSelection.isEmpty;
		
		// Show the user what we're fixing by highlighting it
		editor.selection = new vscode.Selection(errorRange.start, errorRange.end);
		editor.revealRange(errorRange, vscode.TextEditorRevealType.InCenter);
		
		vscode.window.showInformationMessage(
		  `Found ${targetErrors.length} issue(s) at line ${targetLine + 1}. Fetching AI Fix...`
		);
		
		// Now we have the error range, use our existing fixWithAI logic
		try {
		  // Get more context for the AI
		  const fileName = document.fileName.split(/[/\\]/).pop() ?? "";
		  const language = document.languageId;
		  
		  // Get the entire file content for context
		  const entireFileContent = document.getText();
		  
		  // Get the error messages to provide to the AI
		  const errorMessages = targetErrors.map(e => `${e.severity === 0 ? 'ERROR' : 'WARNING'}: ${e.message}`).join('\n');
		  
		  // Get the selected text for the error context
		  const selectedText = document.getText(errorRange);
		  
		  const fixSuggestion = await sendMessageToOpenRouter(`You are an AI assistant fixing code errors and improving code quality.

					I need you to fix code in a ${language} file named "${fileName}".
					
					FULL FILE CONTEXT (for reference only):
					\`\`\`${language}
					${entireFileContent}
					\`\`\`
					
					THE CODE WITH ERRORS (lines ${startLine + 1}-${endLine + 1}):
					\`\`\`${language}
					${selectedText}
					\`\`\`
					
					DIAGNOSTICS FOUND:
					${errorMessages}
					
					Fix the code to address the specific diagnostics listed above. Analyze the code in the context of the entire file.
					Return ONLY the fixed version of the code section without explanations.
					DO NOT return the entire file, only return the fixed code that should replace the selected section.
					
					Response format:
					\`\`\`${language}
					[your fixed code goes here]
					\`\`\`
					`);
					
		  // Apply the fix
		  editor.edit(editBuilder => {
			// Improved regex to better handle various markdown code block formats
			const cleanedCode = fixSuggestion.replace(/^```.*\n?/gm, "")
			  // First, try to match the entire code block pattern and extract just the code
			  .replace(/^```(?:[\w]+)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/g, '$1')
			  // If that doesn't work, try individual replacements as a fallback
			  .replace(/^```(?:[\w]+)?\s*\r?\n?/g, '') // Remove opening fence with language
			  .replace(/\r?\n?```\s*$/g, '')           // Remove closing fence
			  .trim();                                  // Trim any extra whitespace
			
			// Log the cleaned code for debugging
			console.log("Cleaned code:", cleanedCode);
			console.log("Does it still contain markdown fence?", cleanedCode.includes("```"));
			
			// Use errorRange directly rather than editor.selection
			editBuilder.replace(errorRange, cleanedCode);
		  });
		  
		  // If there was an original selection, restore it
		  if (hasOriginalSelection) {
		    editor.selection = originalSelection;
		  }
		  
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

	// Register the command to open the chat panel
	let chatDisposable = vscode.commands.registerCommand("openSourcerer.chatWindow", () => {
	  ChatViewProvider.showChatPanel(context);
	});

	context.subscriptions.push(chatDisposable);

	const provider: vscode.InlineCompletionItemProvider = {
        async provideInlineCompletionItems(document, position, context, token) {
			return new Promise((resolve) => {
				// Clear previous timeout
				if (timeout) {clearTimeout(timeout);}
				// Set a new timeout to delay the API request
				timeout = setTimeout(async () => {
					const completion = await getAICompletion(document,position);

					if (!completion) {
						resolve([]);
						return;
					}

					resolve( [
						new vscode.InlineCompletionItem(
							completion.replace(/^```.*\n?/gm, ""), 
							new vscode.Range(position, position)
						)
					]);
				}, 300); 
			});
        }
    };

    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider)
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}