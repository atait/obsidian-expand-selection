const { Plugin, Notice, FuzzySuggestModal } = require("obsidian");

class JumpModal extends FuzzySuggestModal {
    constructor(app, items, onSelect) {
        super(app);
        this.items = items;
        this.onSelect = onSelect;
        this.instructions = [
            { command: "↑↓", purpose: "to navigate" },
            { command: "↵", purpose: "to choose" },
            { command: "esc", purpose: "to dismiss" }
        ];
        this.setInstructions(this.instructions);
    }

    getItems() {
        return Array.from(this.items.keys());
    }

    getItemText(item) {
        return item;
    }

    onChooseItem(item, evt) {
        this.onSelect(this.items.get(item));
    }
}

class ExpandSelectionPlugin extends Plugin {
    onload() {
        // 🔹 Choose modal using JumpModal
        this.addCommand({
            id: "expand-choose",
            name: "Modal: Line / Section / Note",
            icon: "move-vertical",
            editorCallback: (editor) => {
                const opts = new Map([
                    ["Expand to Line", "line"],
                    ["Expand to Section", "section"],
                    ["Expand to Note", "note"]
                ]);

                new JumpModal(this.app, opts, (choice) => {
                    if (choice === "line") this.expandToLines(editor);
                    else if (choice === "section") this.expandToHeadingSection(editor);
                    else if (choice === "note") this.expandToNote(editor);
                }).open();
            },
        });

        // 🔹 Expand to Line
        this.addCommand({
            id: "expand-line",
            name: "Line",
            icon: "text-cursor-input",
            editorCallback: (editor) => {
                this.expandToLines(editor);
            },
        });

        // 🔹 Expand to Section
        this.addCommand({
            id: "expand-section",
            name: "Section",
            icon: "layout-list",
            editorCallback: (editor) => {
                this.expandToHeadingSection(editor);
            },
        });

        // 🔹 Expand to Note
        this.addCommand({
            id: "expand-note",
            name: "Note",
            icon: "file-text",
            editorCallback: (editor) => {
                this.expandToNote(editor);
            },
        });
    }

    isCompleteLineSelected(editor, selection) {
        let start = selection.anchor.line <= selection.head.line ? selection.anchor : selection.head;
        let end = selection.anchor.line <= selection.head.line ? selection.head : selection.anchor;

        const lineContent = editor.getLine(start.line);
        const isStartAtLineStart = start.ch === 0;
        const isEndAtLineEnd = end.ch === lineContent.length;
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
        const end = { line: endLine, ch: editor.getLine(endLine).length };
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

        // Check if all selections are already complete lines
        const allLinesSelected = selections.every(selection =>
            this.isCompleteLineSelected(editor, selection)
        );

        // If complete lines are selected, check if they form complete sections
        let isCurrentSectionSelected = false;
        if (allLinesSelected) {
            // Get headings to check section boundaries
            const lineCount = editor.lineCount();
            let headings = [];
            for (let i = 0; i < lineCount; i++) {
                const line = editor.getLine(i);
                const match = line.match(/^(#{1,6})(?:\s+(.*))?$/);
                if (match) {
                    headings.push({ line: i, level: match[1].length, text: match[2] || "" });
                }
            }

            if (headings.length > 0) {
                // Check if all selections are complete sections
                isCurrentSectionSelected = selections.every(selection => {
                    const selectionStart = selection.anchor.line <= selection.head.line ? selection.anchor : selection.head;

                    // Find the nearest heading before the selection
                    let currentHeading = null;
                    let currentIndex = -1;
                    for (let i = headings.length - 1; i >= 0; i--) {
                        if (headings[i].line <= selectionStart.line) {
                            currentHeading = headings[i];
                            currentIndex = i;
                            break;
                        }
                    }

                    if (currentHeading) {
                        const { start, end } = this.getSectionBoundaries(editor, currentHeading, currentIndex, headings);
                        return this.isCompleteSectionSelected(editor, selection, start, end);
                    }
                    return false;
                });
            }
        }

        if (allLinesSelected || isCurrentSectionSelected) {
            // If complete lines are already selected, expand to heading ection
            this.expandToHeadingSection(editor);
            return;
        }

        // Otherwise, expand to complete lines including the newline
        const expanded = selections.map(({ anchor, head }) => {
            let start = anchor.line <= head.line ? anchor : head;
            let end = anchor.line <= head.line ? head : anchor;

            start = { line: start.line, ch: 0 };

            // Select to the end of the line, which includes the newline character
            end = { line: end.line, ch: editor.getLine(end.line).length };

            return { anchor: start, head: end };
        });
        editor.setSelections(expanded);
    }

    expandToNote(editor) {
        const lastLine = editor.lineCount() - 1;
        const selectAll = { anchor: { line: 0, ch: 0 }, head: { line: lastLine, ch: editor.getLine(lastLine).length } };
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
                    return { anchor: parentStart, head: parentEnd };
                } else {
                    // No parent, select entire note
                    const lastLine = lineCount - 1;
                    selectedLevels.push(0);
                    return { anchor: { line: 0, ch: 0 }, head: { line: lastLine, ch: editor.getLine(lastLine).length } };
                }
            } else {
                // Select current section
                selectedLevels.push(currentHeading.level);
                return { anchor: start, head: end };
            }
        });

        editor.setSelections(expandedSelections);
        return { levels: selectedLevels };
    }

    onunload() {}
};

class SmartExpandPlugin extends ExpandSelectionPlugin {
    onload() {
        // Single smart expand command
        this.addCommand({
            id: "smart-expand",
            name: "Smart Expand",
            icon: "expand",
            editorCallback: (editor) => {
                this.smartExpand(editor);
            },
        });
        super.onload();
    }

    smartExpand(editor) {
        const beforeSelection = this.getSelectionsString(editor);

        // Try expanding to lines first
        this.expandToLines(editor);

        // Check if selection changed
        const afterLinesSelection = this.getSelectionsString(editor);
        if (beforeSelection === afterLinesSelection) {
            // Lines didn't change, try expanding to section
            this.expandToHeadingSection(editor);

            // Check if section expansion changed anything
            const afterSectionSelection = this.getSelectionsString(editor);
            if (afterLinesSelection === afterSectionSelection) {
                // Section didn't change either, try expanding to note
                this.expandToNote(editor);
            }
        }
    }

    expandToLines(editor) {
        const selections = editor.listSelections();
        const expanded = selections.map(({ anchor, head }) => {
            let start = anchor.line <= head.line ? anchor : head;
            let end = anchor.line <= head.line ? head : anchor;

            start = { line: start.line, ch: 0 };
            end = { line: end.line, ch: editor.getLine(end.line).length };

            return { anchor: start, head: end };
        });
        editor.setSelections(expanded);
    }
}

module.exports = SmartExpandPlugin;
