const { Plugin, Notice } = require("obsidian");

// Developer switch: Set to true to include newline terminators in selections
const includeTerminators = false;

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
            name: "Hierarchical Expand (Section)",
            icon: "layout-list",
            editorCallback: (editor) => {
                this.expandToHeadingSection_Lazy(editor);
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

    isCompleteLineSelected(editor, selection) {
        let start = selection.anchor.line <= selection.head.line ? selection.anchor : selection.head;
        let end = selection.anchor.line <= selection.head.line ? selection.head : selection.anchor;

        const isStartAtLineStart = start.ch === 0;
        const isEndAtLineEnd = end.ch === this.getEndCharPosition(editor, end.line);
        const isSingleLine = start.line === end.line;

        return isSingleLine && isStartAtLineStart && isEndAtLineEnd;
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

    expandToHeadingSection_Eager(editor) {
        /**
         * Expands the selection to the section the cursor or selection is in.
         * If the full section is already selected, expands to the parent section.
         * If before the first heading, expands to full note.
         *
         * Eager: Expansion logic is based on calculations of lines and cursor positions
         * Lazy: Logic is based on comparing selection before/after expansion
         */
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
            // No headings, select entire note
            this.expandToNote(editor);
            return { levels: [0] };
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
                // Cursor is above first heading, select everything before first heading
                const firstHeading = headings[0];
                const endLine = Math.max(0, firstHeading.line - 1);
                // Find line after YAML frontmatter
                let startLine = 0;
                const firstLine = editor.getLine(0);
                if (firstLine.startsWith('---')) {
                    for (let i = 1; i < lineCount; i++) {
                        if (editor.getLine(i).startsWith('---')) {
                            startLine = i + 1;
                            break;
                        }
                    }
                }
                const start = { line: startLine, ch: 0 };
                let end = { line: endLine, ch: this.getEndCharPosition(editor, endLine) };

                // Check if current selection includes all pre-heading text
                let currentStart = currentSelection.head;
                let currentEnd = currentSelection.anchor;
                if (currentSelection.anchor.line <= currentSelection.head.line) {
                    currentStart = currentSelection.anchor;
                    currentEnd = currentSelection.head;
                }
                if (currentStart.line === start.line && currentStart.ch === start.ch &&
                    (currentEnd.line === end.line && currentEnd.ch === end.ch ||
                        currentEnd.line === end.line + 1 && currentEnd.ch === 0
                    )) {
                    // All pre-heading text is selected, expand to entire note
                    end = { line: lineCount - 1, ch: this.getEndCharPosition(editor, lineCount - 1) };
                }
                selectedLevels.push(firstHeading.level + 1); // Virtual level for content before first heading
                return { head: start, anchor: end };
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

    expandToHeadingSection_Lazy(editor) {
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
