const { Plugin } = require("obsidian");

class ExpandSelectionPlugin extends Plugin {
    onload() {
        // Smart expand by sections: line → section → parent → note
        this.addCommand({
            id: "smart-expand-section",
            name: "Hierarchical Expand (Section)",
            icon: "text-select",
            editorCallback: (editor) => {
                this.expandToHeadingSection(editor);
            },
        });

        // Smart expand by lines: line → next line → next line → etc
        this.addCommand({
            id: "smart-expand-lines",
            name: "Series Expand (Lines)",
            icon: "text-cursor-input",
            editorCallback: (editor) => {
                this.smartExpandLines(editor);
            },
        });

        super.onload();
    }

    /**
     * Gets the character position at the end of a line (excluding newline)
     * @param {Editor} editor - The CodeMirror editor instance
     * @param {number} lineNumber - The line number
     * @returns {number} The character position at the end of the line
     */
    getEndCharPosition(editor, lineNumber) {
        return editor.getLine(lineNumber).length;
    }

    // Helper methods

    getHeadings(editor) {
        const lineCount = editor.lineCount();
        let headings = [];
        for (let i = 0; i < lineCount; i++) {
            const line = editor.getLine(i);
            const match = line.match(/^(#{1,6})(?:\s+(.*))?$/);
            if (match) {
                headings.push({ line: i, level: match[1].length, text: match[2] || "" });
            }
        }
        return headings;
    }

    selectionToString(selection) {
        return `${selection.anchor.line}:${selection.anchor.ch}-${selection.head.line}:${selection.head.ch}`;
    }

    getSelectionsString(editor) {
        return editor.listSelections().map(s => this.selectionToString(s)).join("|");
    }

    getNoteStartline(editor) {
        // Find line after YAML frontmatter
        const firstLine = editor.getLine(0);
        if (firstLine.startsWith('---')) {
            for (let i = 1; i < editor.lineCount(); i++) {
                if (editor.getLine(i).startsWith('---')) {
                    return i + 1;
                }
            }
        }
        return 0;
    }

    // Boundary getting methods

    getNoteBoundaries(editor) {
        const lastLine = editor.lineCount() - 1;
        const start = { line: this.getNoteStartline(editor), ch: 0 };
        const end = { line: lastLine, ch: this.getEndCharPosition(editor, lastLine) };
        return { start, end };
    }

    getPreheadingBoundaries(editor) {
        // Before first heading, select pre-heading content
        const headings = this.getHeadings(editor);
        if (headings.length === 0) {
            return this.getNoteBoundaries(editor);
        }
        const firstHeading = headings[0];
        const endLine = Math.max(0, firstHeading.line - 1);
        const startLine = this.getNoteStartline(editor);

        const start = { line: startLine, ch: 0 };
        const end = { line: endLine, ch: this.getEndCharPosition(editor, endLine) };

        return { start, end };
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

    // Expansion methods (with side effects)

    expandLines(editor, extendByOne = false) {
        const selections = editor.listSelections();
        const expanded = selections.map(({ anchor, head }) => {
            let start = anchor.line <= head.line ? anchor : head;
            let end = anchor.line <= head.line ? head : anchor;

            start = { line: start.line, ch: 0 };
            end = { line: end.line, ch: this.getEndCharPosition(editor, end.line) };

            // If extendByOne is true and we're already at line boundaries, extend by one line
            if (extendByOne && start.ch === 0 && end.ch === this.getEndCharPosition(editor, end.line)) {
                const nextLine = Math.min(end.line + 1, editor.lineCount() - 1);
                end = { line: nextLine, ch: this.getEndCharPosition(editor, nextLine) };
            }

            return { head: start, anchor: end };
        });
        editor.setSelections(expanded);
    }

    expandToNote(editor) {
        const { start, end } = this.getNoteBoundaries(editor);
        const selectAll = { head: start, anchor: end };
        editor.setSelections([selectAll]);
    }

    /**
     * Main hierarchical expansion method using lazy evaluation
     * Progresses through: lines → current section → parent section → entire note
     * Uses before/after comparison to determine when to advance to next level
     * @param {Editor} editor - The CodeMirror editor instance
     */
    expandToHeadingSection(editor) {
        const beforeSelection = this.getSelectionsString(editor);

        // Try expanding to lines first
        this.expandLines(editor);
        // Check if selection changed
        if (beforeSelection !== this.getSelectionsString(editor)) {
            return;
        }

        // Lines didn't change, try expanding to section
        this.expandToCurrentSection(editor);
        // Check if section expansion changed anything
        if (beforeSelection !== this.getSelectionsString(editor)) {
            return;
        }

        this.expandToParentSection(editor);
        // Check if parent expansion changed anything
        if (beforeSelection !== this.getSelectionsString(editor)) {
            return;
        }

        this.expandToNote(editor);
    }

    findCurrentHeading(editor, currentSelection, headings) {
        const effectivePosition = currentSelection.anchor.line <= currentSelection.head.line ? currentSelection.anchor : currentSelection.head;

        // Find current heading
        let currentHeading = null;
        let currentIndex = -1;
        for (let i = headings.length - 1; i >= 0; i--) {
            if (headings[i].line <= effectivePosition.line) {
                currentHeading = headings[i];
                currentIndex = i;
                break;
            }
        }
        return { currentHeading, currentIndex };
    }

    expandToCurrentSection(editor) {
        const headings = this.getHeadings(editor);
        const selections = editor.listSelections();

        if (headings.length === 0) {
            this.expandToNote(editor);
            return;
        }

        // Expand each selection to its current section
        const expandedSelections = selections.map(currentSelection => {
            let { currentHeading, currentIndex } = this.findCurrentHeading(editor, currentSelection, headings);

            if (!currentHeading) {
                const { start, end } = this.getPreheadingBoundaries(editor);
                return { head: start, anchor: end };
            } else {
                const { start, end } = this.getSectionBoundaries(editor, currentHeading, currentIndex, headings);
                return { head: start, anchor: end };
            }
        });
        console.log(expandedSelections);

        editor.setSelections(expandedSelections);
    }

    expandToParentSection(editor) {
        const headings = this.getHeadings(editor);
        const selections = editor.listSelections();

        if (headings.length === 0) {
            return; // No headings, nothing to expand to parent
        }

        // Expand each selection to its parent section
        const expandedSelections = selections.map(currentSelection => {
            let { currentHeading, currentIndex } = this.findCurrentHeading(editor, currentSelection, headings);

            if (!currentHeading) {
                // Before first heading, select entire note
                const { start, end } = this.getNoteBoundaries(editor);
                return { head: start, anchor: end };
            }

            // Find parent heading
            let parentHeading = null;
            let parentIndex = -1;
            for (let i = currentIndex - 1; i >= 0; i--) {
                if (headings[i].level < currentHeading.level) {
                    parentHeading = headings[i];
                    parentIndex = i;
                    break;
                }
            }

            if (parentHeading) {
                // Expand to parent section
                const { start, end } = this.getSectionBoundaries(editor, parentHeading, parentIndex, headings);
                return { head: start, anchor: end };
            } else {
                // No parent, select entire note
                const { start, end } = this.getNoteBoundaries(editor);
                return { head: start, anchor: end };
            }
        });

        editor.setSelections(expandedSelections);
    }

    smartExpandLines(editor) {
        const beforeSelection = this.getSelectionsString(editor);

        // Try expanding to lines first
        this.expandLines(editor);

        // Check if selection changed
        if (beforeSelection !== this.getSelectionsString(editor)) {
            return;
        }
        // Already at line boundaries, try adding next line
        this.expandLines(editor, true);
    }

    onunload() {}
    }

module.exports = ExpandSelectionPlugin;
