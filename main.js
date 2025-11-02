const { Plugin, Notice } = require("obsidian");

// Developer switch: Set to true to include newline terminators in selections
const includeTerminators = true;

class ExpandSelectionPlugin extends Plugin {
    getEndCharPosition(editor, lineNumber) {
        const lineContent = editor.getLine(lineNumber);
        const lastLine = editor.lineCount() - 1;

        if (includeTerminators && lineNumber !== lastLine) {
            // Include newline character for all lines except the last line
            return lineContent.length + 1;
        } else {
            // Don't include newline (old behavior or last line)
            return lineContent.length;
        }
    }

    onload() {
        // Smart expand by sections: line → section → parent → note
        this.addCommand({
            id: "smart-expand-section",
            name: "Smart Expand (Section)",
            icon: "layout-list",
            editorCallback: (editor) => {
                this.expandToHeadingSection(editor);
            },
        });

        // Smart expand by lines: line → next line → next line → etc
        this.addCommand({
            id: "smart-expand-lines",
            name: "Smart Expand (Lines)",
            icon: "text-cursor-input",
            editorCallback: (editor) => {
                this.smartExpandLines(editor);
            },
        });

        super.onload();

        /* To deprecate
        // Expand to Line
        this.addCommand({
            id: "expand-line",
            name: "Line",
            icon: "text-cursor-input",
            editorCallback: (editor) => {
                this.expandToLines(editor);
            },
        });

        // Expand to Section
        this.addCommand({
            id: "expand-section",
            name: "Section",
            icon: "layout-list",
            editorCallback: (editor) => {
                this.expandToHeadingSection(editor);
            },
        });
        */
    }

    isCompleteLineSelected(editor, selection) {
        let start = selection.anchor.line <= selection.head.line ? selection.anchor : selection.head;
        let end = selection.anchor.line <= selection.head.line ? selection.head : selection.anchor;

        const isStartAtLineStart = start.ch === 0;
        const isEndAtLineEnd = end.ch === this.getEndCharPosition(editor, end.line);
        const isSingleLine = start.line === end.line;

        return isSingleLine && isStartAtLineStart && isEndAtLineEnd;
    }

    getSectionBoundaries(editor, currentHeading, currentIndex, headings) {
        const lineCount = editor.lineCount();
        const start = { line: currentHeading.line, ch: 0 };
        let endLine = lineCount - 1;
        for (let i = currentIndex + 1; i < headings.length; i++) {
            if (headings[i].level <= currentHeading.level) {
                endLine = Math.max(0, headings[i].line - 1);
                break;
            }
        }

        const end = { line: endLine, ch: this.getEndCharPosition(editor, endLine) };
        return { start, end };
    }

    isCompleteSectionSelected(editor, selection, start, end) {
        const currentStart = selection.anchor.line <= selection.head.line ? selection.anchor : selection.head;
        const currentEnd = selection.anchor.line <= selection.head.line ? selection.head : selection.anchor;

        return currentStart.line === start.line && currentEnd.line >= end.line;
    }

    selectionToString(selection) {
        return `${selection.anchor.line}:${selection.anchor.ch}-${selection.head.line}:${selection.head.ch}`;
    }

    getSelectionsString(editor) {
        return editor.listSelections().map(s => this.selectionToString(s)).join("|");
    }

    expandToLines(editor) {
        const selections = editor.listSelections();
        const expanded = selections.map(({ anchor, head }) => {
            let start = anchor.line <= head.line ? anchor : head;
            let end = anchor.line <= head.line ? head : anchor;

            start = { line: start.line, ch: 0 };
            end = { line: end.line, ch: this.getEndCharPosition(editor, end.line) };

            return { head: start, anchor: end };
        });
        editor.setSelections(expanded);
    }

    expandToNote(editor) {
        const lastLine = editor.lineCount() - 1;
        const selectAll = { head: { line: 0, ch: 0 }, anchor: { line: lastLine, ch: this.getEndCharPosition(editor, lastLine) } };
        editor.setSelections([selectAll]);
    }

    expandToHeadingSection(editor) {
        const lineCount = editor.lineCount();
        const selections = editor.listSelections();

        // Gather all headings efficiently
        let headings = [];
        for (let i = 0; i < lineCount; i++) {
            const line = editor.getLine(i);
            const match = line.match(/^(#{1,6})(?:\s+(.*))?$/);
            if (match) {
                headings.push({ line: i, level: match[1].length, text: match[2] || "" });
            }
        }

        if (headings.length === 0) {
            new Notice("No headings found in note.");
            return;
        }

        // Process each selection
        const selectedLevels = [];
        const expandedSelections = selections.map(currentSelection => {
            // Determine the effective start position for finding current heading
            const selectionStart = currentSelection.anchor.line <= currentSelection.head.line ? currentSelection.anchor : currentSelection.head;
            const effectivePosition = selectionStart;

            // Find the nearest heading before the effective position
            let currentHeading = null;
            let currentIndex = -1;
            for (let i = headings.length - 1; i >= 0; i--) {
                if (headings[i].line <= effectivePosition.line) {
                    currentHeading = headings[i];
                    currentIndex = i;
                    break;
                }
            }

            if (!currentHeading) {
                // No enclosing section found, return original selection
                selectedLevels.push(null);
                return currentSelection;
            }

            // Calculate current section boundaries
            const { start, end } = this.getSectionBoundaries(editor, currentHeading, currentIndex, headings);

            // Check if current selection already contains this entire section
            const isCurrentSectionSelected = this.isCompleteSectionSelected(editor, currentSelection, start, end);

            if (isCurrentSectionSelected) {
                // Already selected this section, expand to parent
                let parentHeading = null;
                let parentIndex = -1;

                // Find the nearest parent heading (higher level = smaller number)
                for (let i = currentIndex - 1; i >= 0; i--) {
                    if (headings[i].level < currentHeading.level) {
                        parentHeading = headings[i];
                        parentIndex = i;
                        break;
                    }
                }

                if (parentHeading) {
                    // Expand to parent section
                    const { start: parentStart, end: parentEnd } = this.getSectionBoundaries(editor, parentHeading, parentIndex, headings);
                    selectedLevels.push(parentHeading.level);
                    return { head: parentStart, anchor: parentEnd };
                } else {
                    // No parent, select entire note
                    const lastLine = lineCount - 1;
                    selectedLevels.push(0);
                    return { head: { line: 0, ch: 0 }, anchor: { line: lastLine, ch: this.getEndCharPosition(editor, lastLine) } };
                }
            } else {
                // Select current section
                selectedLevels.push(currentHeading.level);
                return { head: start, anchor: end };
            }
        });

        editor.setSelections(expandedSelections);
        return { levels: selectedLevels };
    }

    onunload() {}

    smartExpandSection(editor) {
        const beforeSelection = this.getSelectionsString(editor);

        // Try expanding to lines first
        this.expandToLines(editor);

        // Check if selection changed
        const afterLinesSelection = this.getSelectionsString(editor);
        if (beforeSelection === afterLinesSelection) {
            // Lines didn't change, try expanding to section (which handles parent → note automatically)
            this.expandToHeadingSection(editor);
        }
    }

    smartExpandLines(editor) {
        const beforeSelection = this.getSelectionsString(editor);

        // Try expanding to lines first
        this.expandToLines(editor);

        // Check if selection changed
        const afterLinesSelection = this.getSelectionsString(editor);
        if (beforeSelection === afterLinesSelection) {
            // Already at line boundaries, try adding next line
            this.expandToNextLine(editor);
        }
    }

    expandToNextLine(editor) {
        const selections = editor.listSelections();
        const expanded = selections.map(({ anchor, head }) => {
            let start = anchor.line <= head.line ? anchor : head;
            let end = anchor.line <= head.line ? head : anchor;

            // If we're already at line boundaries, extend by one line
            if (start.ch === 0 && end.ch === this.getEndCharPosition(editor, end.line)) {
                const nextLine = Math.min(end.line + 1, editor.lineCount() - 1);
                // Head at end of selection (start), anchor at beginning of next line
                start = { line: start.line, ch: 0 };
                end = { line: nextLine, ch: this.getEndCharPosition(editor, nextLine) };
                return { head: end, anchor: start };
            } else {
                // Not at line boundaries, expand to current lines
                start = { line: start.line, ch: 0 };
                end = { line: end.line, ch: this.getEndCharPosition(editor, end.line) };
                return { head: start, anchor: end };
            }
        });
        editor.setSelections(expanded);
    }

    };

module.exports = ExpandSelectionPlugin;
