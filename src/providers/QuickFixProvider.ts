import * as vscode from "vscode";

export class QuickFixProvider implements vscode.CodeActionProvider {
  static providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    
    console.log("QuickFixProvider triggered:", context.diagnostics);

    if (context.diagnostics.length === 0) {
      console.log("No diagnostics found, skipping Quick Fix.");
      return [];
    }

    const fix = new vscode.CodeAction("Fix with AI", vscode.CodeActionKind.QuickFix);
    fix.command = {
      title: "Fix with AI",
      command: "openSourcerer.fixWithAI",
      arguments: [document, range]
    };

    return [fix];
  }
}
