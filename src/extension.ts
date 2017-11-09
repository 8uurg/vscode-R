"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { commands, ExtensionContext, languages, Position, Range, window, workspace, Selection } from "vscode";
import { createGitignore } from "./rGitignore";
import { installLintr, lintr } from "./rLint";
import { createRTerm, deleteTerminal, rTerm } from "./rTerminal";
import { SectionCodeLensProvider } from "./rSectionLens";
import { checkForSpecialCharacters, checkIfFileExists, config, delay } from "./util";

import fs = require("fs-extra");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json

    function runSource(echo: boolean)  {
        const wad = window.activeTextEditor.document;
        wad.save();
        let rPath = ToRStringLiteral(wad.fileName, '"');
        let encodingParam = config.get("source.encoding") as string;
        if (encodingParam) {
            encodingParam = `encoding = "${encodingParam}"`;
            rPath = [rPath, encodingParam].join(", ");
        }
        if (echo) {
            rPath = [rPath, "echo = TRUE"].join(", ");
        }
        if (!rTerm) {
            const success = createRTerm(true);
            if (!success) { return; }
        }
        rTerm.sendText(`source(${rPath})`);
        setFocus();
    }

    function countBlockStartsAndEnds(textArray: string[]) {
        let blockStartsCount = 0;
        let blockEndsCount = 0;
        for (const text of textArray) {
            blockStartsCount += text.replace(/[^{]/g, "").length;
            blockEndsCount += text.replace(/[^}]/g, "").length;
        }
        return { numberBlockStarts: blockStartsCount, numberBlockEnds: blockEndsCount };
    }

    function getSelection(): any {
        const selection = { linesDownToMoveCursor: 0, selectedTextArray: [] };
        const { start, end } = window.activeTextEditor.selection;
        const currentDocument = window.activeTextEditor.document;
        const range = new Range(start, end);

        let selectedLine: string;
        if (!range.isEmpty) {
            const newStart = new Position(start.line, 0);
            selectedLine = currentDocument.getText(new Range(newStart, end));
        } else {
            selectedLine = currentDocument.lineAt(start.line).text;
        }

        const selectedTextArray = selectedLine.split("\n");

        const blocks = countBlockStartsAndEnds(selectedTextArray);
        if (blocks.numberBlockStarts > blocks.numberBlockEnds) {
            let lineIndex = 1;
            while (blocks.numberBlockStarts !== blocks.numberBlockEnds) {
                selectedLine = currentDocument.lineAt(end.line + lineIndex).text;
                selectedTextArray.push(selectedLine);

                const thisLineBlocks = countBlockStartsAndEnds([selectedLine]);
                blocks.numberBlockStarts += thisLineBlocks.numberBlockStarts;
                blocks.numberBlockEnds += thisLineBlocks.numberBlockEnds;
                lineIndex++;
            }
            selection.linesDownToMoveCursor = lineIndex;
        } else if (blocks.numberBlockStarts < blocks.numberBlockEnds) {
            let lineIndex = 1;
            while (blocks.numberBlockStarts !== blocks.numberBlockEnds) {
                selectedLine = currentDocument.lineAt(start.line - lineIndex).text;
                selectedTextArray.unshift(selectedLine);

                const thisLineBlocks = countBlockStartsAndEnds([selectedLine]);
                blocks.numberBlockStarts += thisLineBlocks.numberBlockStarts;
                blocks.numberBlockEnds += thisLineBlocks.numberBlockEnds;
                lineIndex++;
            }
            selection.linesDownToMoveCursor = 0;
        }
        selection.selectedTextArray = selectedTextArray;

        return selection;
    }

    async function runSelection() {
        const selection = getSelection();

        if (!rTerm) {
            const success = createRTerm(true);
            if (!success) { return; }
            await delay (200); // Let RTerm warm up
        }
        commands.executeCommand("cursorMove", { to: "down", value: selection.linesDownToMoveCursor });
        for (const line of selection.selectedTextArray) {
            if (checkForComment(line)) { continue; }
            await delay(8); // Increase delay if RTerm can't handle speed.
            rTerm.sendText(line);
        }
        setFocus();
    }

    async function runLineRange(range: Range) {
        if (!rTerm) {
            const success = createRTerm(true);
            if (!success) { return; }
            await delay (200); // Let RTerm warm up
        }
        const document = window.activeTextEditor.document;
        
        const lines = document.getText(range).split('\n');
       
        for (const line of lines) {
            if (checkForComment(line)) { continue; }
            await delay(8); // Increase delay if RTerm can't handle speed.
            rTerm.sendText(line);
        }
        setFocus();
    }

    async function runSectionAndGoToNext(range: Range, nextPosition: Position) {
        runLineRange(range);
        window.activeTextEditor.selections = [new Selection(nextPosition, nextPosition)];
    }

    function setFocus() {
        const focus = config.get("source.focus") as string;
        if (focus === "terminal") {
            rTerm.show();
        }
    }

    function checkForComment(line): boolean {
        let index = 0;
        while (index < line.length) {
            if (!(line[index] === " ")) { break; }
            index++;
        }
        return line[index] === "#";
    }

    function makeTmpDir() {
        let tmpDir = workspace.rootPath;
        if (process.platform === "win32") {
            tmpDir = tmpDir.replace(/\\/g, "/");
            tmpDir += "/tmp";
        } else {
            tmpDir += "/.tmp";
        }
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir);
        }
        return tmpDir;
    }

    async function previewEnvironment() {
        if (!rTerm) {
            const success = createRTerm(true);
            if (!success) { return; }
        }
        const tmpDir = makeTmpDir();
        const pathToTmpCsv = tmpDir + "/environment.csv";
        const envName = "name=ls()";
        const envClass = "class=sapply(ls(), function(x) {class(get(x))})";
        const envOut = "out=sapply(ls(), function(x) {capture.output(str(get(x)), silent = T)[1]})";
        const rWriteCsvCommand = "write.csv(data.frame("
                                 + envName + ","
                                 + envClass + ","
                                 + envOut + "), '"
                                 + pathToTmpCsv + "', row.names=FALSE, quote = TRUE)";
        rTerm.sendText(rWriteCsvCommand);
        await openTmpCSV(pathToTmpCsv, tmpDir);
    }

    async function previewDataframe() {
        if (!rTerm) {
            const success = createRTerm(true);
            if (!success) { return; }
        }

        const dataframeName = getSelection();

        if (!checkForSpecialCharacters(dataframeName)) {
            window.showInformationMessage("This does not appear to be a dataframe.");
            return false;
        }

        const tmpDir = makeTmpDir();

        // Create R write CSV command.  Turn off row names and quotes, they mess with Excel Viewer.
        const pathToTmpCsv = tmpDir + "/" + dataframeName + ".csv";
        const rWriteCsvCommand = "write.csv(" + dataframeName + ", '"
                                + pathToTmpCsv
                                + "', row.names = FALSE, quote = FALSE)";
        rTerm.sendText(rWriteCsvCommand);
        await openTmpCSV(pathToTmpCsv, tmpDir);
    }

    async function openTmpCSV(pathToTmpCsv: string, tmpDir: string) {
        await delay(350); // Needed since file size has not yet changed

        if (!checkIfFileExists(pathToTmpCsv)) {
            window.showErrorMessage("Dataframe failed to display.");
            fs.removeSync(tmpDir);
            return false;
        }

        // Async poll for R to complete writing CSV.
        const success = await waitForFileToFinish(pathToTmpCsv);
        if (!success) {
            window.showWarningMessage("Visual Studio Code currently limits opening files to 20 MB.");
            fs.removeSync(tmpDir);
            return false;
        }

        if (process.platform === "win32") {
            const winattr = require("winattr");
            winattr.setSync(tmpDir, {hidden: true});
        }

        // Open CSV in Excel Viewer and clean up.
        workspace.openTextDocument(pathToTmpCsv).then(async (file) => {
            await commands.executeCommand("csv.preview", file.uri);
            fs.removeSync(tmpDir);
                });
    }

    async function waitForFileToFinish(filePath) {
        const fileBusy = true;
        let currentSize = 0;
        let previousSize = 1;

        while (fileBusy) {
            const stats = fs.statSync(filePath);
            currentSize = stats.size;

            // UPDATE: We are now limited to 20 mb by MODEL_TOKENIZATION_LIMIT
            // https://github.com/Microsoft/vscode/blob/master/src/vs/editor/common/model/textModel.ts#L34
            if (currentSize > 2 * 10000000) { // 20 MB
                return false;
            }

            if (currentSize === previousSize) {
                return true;
            } else {
                previousSize = currentSize;
            }
            await delay(50);
        }
    }

    context.subscriptions.push(
        commands.registerCommand("r.runSource", () => runSource(false)),
        commands.registerCommand("r.createRTerm", createRTerm),
        commands.registerCommand("r.runSourcewithEcho", () => runSource(true)),
        commands.registerCommand("r.runSelection", runSelection),
        commands.registerCommand("r.createGitignore", createGitignore),
        commands.registerCommand("r.lintr", lintr),
        commands.registerCommand("r.previewDataframe", previewDataframe),
        commands.registerCommand("r.previewEnvironment", previewEnvironment),
        commands.registerCommand("r.installLintr", installLintr),
        commands.registerCommand("r.runSection", runLineRange),
        commands.registerCommand("r.runSectionGoToNext", runSectionAndGoToNext),
        languages.registerCodeLensProvider('r', new SectionCodeLensProvider()),
        workspace.onDidSaveTextDocument(lintr),
        window.onDidCloseTerminal(deleteTerminal),
    );

    function ToRStringLiteral(s: string, quote: string) {
        if (s === null) {
            return "NULL";
        }
        return (quote +
                s.replace(/\\/g, "\\\\")
                .replace(/"""/g, "\\" + quote)
                .replace(/\\n/g, "\\n")
                .replace(/\\r/g, "\\r")
                .replace(/\\t/g, "\\t")
                .replace(/\\b/g, "\\b")
                .replace(/\\a/g, "\\a")
                .replace(/\\f/g, "\\f")
                .replace(/\\v/g, "\\v") +
                quote);
    }
}

// This method is called when your extension is deactivated
// export function deactivate() {

// }
