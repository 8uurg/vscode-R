import { CodeLensProvider, TextDocument, Event, CancellationToken, CodeLens, Range, Position, Command } from "vscode";

class RunSectionCommand implements Command {
    title: string = "Run Section";
    command: string = "r.runSection";
    tooltip?: string = "Run this section.";
    arguments?: any[];

    constructor(range: Range) {
        this.arguments = [range];
    }
}

class RunSectionGoToNextCommand implements Command {
    title: string = "Run Section and go to next";
    command: string = "r.runSectionGoToNext";
    tooltip?: string = "Run this section and continue on to the next section.";
    arguments?: any[];

    constructor(range: Range, nextPosition: Position) {
        this.arguments = [range, nextPosition];
    }
}

export class SectionCodeLensProvider implements CodeLensProvider {

    provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] {
        const sectionRegex = /^\w*#.*[=\-#]{4,}\w*$/;
        let lenses : CodeLens[] = [];
        let match : RegExpExecArray;
        let lastpos : Position = new Position(0,0);
        for (let i = 1; i < document.lineCount; i++) {
            if ((match = sectionRegex.exec(document.lineAt(i).text)) !== null) {
                const endPosition = new Position(i - 1, 0);
                const currentPosition = new Position(i, 0);
                lenses.push(...this.createLenses(new Range(lastpos, endPosition), currentPosition))
                lastpos = currentPosition
            }
        }
        // No sections were present in the document, adding sections does not make sense.
        if (lenses.length === 0) return [];

        lenses.push(...this.createLenses(new Range(lastpos, new Position(document.lineCount, 0)), new Position(document.lineCount, 0)))
        return lenses;
    }

    createLenses(range: Range, nextPosition: Position): CodeLens[] {
        return [new CodeLens(range, new RunSectionCommand(range)),
                new CodeLens(range, new RunSectionGoToNextCommand(range, nextPosition))];
    }
    
}