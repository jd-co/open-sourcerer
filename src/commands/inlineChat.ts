import * as vscode from "vscode";
import { sendMessageToOpenRouter } from "../utils/api";
import { SYSTEM_PROMPTS } from "../prompts";

let currentDecorations: vscode.TextEditorDecorationType[] = [];
let activeSuggestion: {
    code: string;
    selection: vscode.Selection;
    editor: vscode.TextEditor;
    previewRange?: vscode.Range;
} | undefined = undefined;

function clearDecorations() {
    currentDecorations.forEach(d => d.dispose());
    currentDecorations = [];
    activeSuggestion = undefined;
}

export async function triggerInlineChat(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor found!");
        return;
    }

    clearDecorations();

    const position = editor.selection.active;
    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);
    const range = new vscode.Range(position.line, 0, position.line, 0);

    // Create inline input box with cursor style
    const inputBoxDecoration = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: "Editing instructions... ",
            color: "var(--vscode-editor-foreground)",
            backgroundColor: "var(--vscode-editor-background)",
            margin: "0 0 0 0",
            width: "100%",
            height: "100%",
            textDecoration: "none; border-bottom: 1px solid var(--vscode-input-border);",
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
        isWholeLine: true,
    });

    // Create the close button decoration
    const closeButtonDecoration = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: "Esc to close",
            color: "var(--vscode-descriptionForeground)",
            margin: "0 8px",
            textDecoration: "none;",
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    });

    currentDecorations.push(inputBoxDecoration, closeButtonDecoration);
    editor.setDecorations(inputBoxDecoration, [range]);
    editor.setDecorations(closeButtonDecoration, [range]);

    const userQuery = await vscode.window.showInputBox({
        prompt: "",
        placeHolder: "Type your instructions here...",
        ignoreFocusOut: true
    });

    clearDecorations();

    if (!userQuery) return;

    // Show loading state
    const loadingDecoration = vscode.window.createTextEditorDecorationType({
        before: {
            contentText: "🤖 AI is thinking...",
            color: "var(--vscode-descriptionForeground)",
            margin: "0 8px",
        },
        isWholeLine: true,
    });

    currentDecorations.push(loadingDecoration);
    editor.setDecorations(loadingDecoration, [range]);

    try {
        const fileExtension = editor.document.fileName.split('.').pop() ?? "plaintext";
        const prompt = `${SYSTEM_PROMPTS.INLINE_CODE_ASSISTANT} 
            File Extension: ${fileExtension} 
            User Query: ${userQuery}
            Context: ${selectedText}`;
        
        const aiResponse = await sendMessageToOpenRouter(prompt);
        if (!aiResponse) {
            vscode.window.showErrorMessage("AI response failed.");
            return;
        }

        const codeMatch = RegExp(/```(?:\w+)?\n([\s\S]+?)\n```/).exec(aiResponse);
        const generatedCode = codeMatch ? codeMatch[1] : aiResponse.trim();

        clearDecorations();

        // Store current suggestion with preview range
        activeSuggestion = {
            code: generatedCode,
            selection: selection,
            editor: editor,
            previewRange: new vscode.Range(position.line, 0, position.line + generatedCode.split('\n').length, 0)
        };

        // Create the preview using a temporary document
        const previewContent = generatedCode;
        const startLine = position.line;
        const endLine = startLine + previewContent.split('\n').length;
        const previewRange = new vscode.Range(startLine, 0, endLine, 0);

        // Create decorations for the preview
        const headerDecoration = vscode.window.createTextEditorDecorationType({
            before: {
                contentText: "AI Suggestion",
                color: "var(--vscode-descriptionForeground)",
                margin: "8px 0",
            },
            backgroundColor: "var(--vscode-editor-background)",
            isWholeLine: true,
        });

        const codeDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
            isWholeLine: true,
        });

        // Insert the preview content temporarily
        await editor.edit(editBuilder => {
            // First replace the selected text with the preview
            editBuilder.replace(selection, previewContent);
        });

        // Apply decorations
        currentDecorations.push(headerDecoration, codeDecoration);
        editor.setDecorations(headerDecoration, [new vscode.Range(selection.start.line, 0, selection.start.line, 0)]);
        editor.setDecorations(codeDecoration, [new vscode.Range(selection.start.line, 0, selection.start.line + previewContent.split('\n').length, 0)]);

        // Show QuickPick for accept/reject
        const result = await vscode.window.showQuickPick(
            ['Accept Suggestion', 'Reject Suggestion'],
            {
                placeHolder: 'Choose an action',
                ignoreFocusOut: true
            }
        );

        if (result === 'Accept Suggestion') {
            editor.edit(editBuilder => {
                editBuilder.replace(selection, generatedCode);
            });
        } else if (result === 'Reject Suggestion') {
            editor.edit(editBuilder => {
                editBuilder.replace(selection, selectedText);
            });
        }

        clearDecorations();

    } catch (error) {
        vscode.window.showErrorMessage("Error fetching AI response.");
        clearDecorations();
    }
}

// Register the toggle command
export function registerInlineChatCommands(context: vscode.ExtensionContext) {
    // Register the main inline chat command
    context.subscriptions.push(
        vscode.commands.registerCommand('openSourcerer.inlineChat', () => triggerInlineChat(context))
    );

    // Register the accept command
    context.subscriptions.push(
        vscode.commands.registerCommand('openSourcerer.acceptSuggestion', () => {
            if (!activeSuggestion) return;
            
            const { editor, selection, code } = activeSuggestion;
            
            editor.edit(editBuilder => {
                editBuilder.replace(selection, code);
            });
            clearDecorations();
        })
    );

    // Register the reject command
    context.subscriptions.push(
        vscode.commands.registerCommand('openSourcerer.rejectSuggestion', () => {
            if (!activeSuggestion) return;
            
            const { editor, selection } = activeSuggestion;
            
            editor.edit(editBuilder => {
                editBuilder.replace(selection, editor.document.getText(selection));
            });
            clearDecorations();
        })
    );
}
