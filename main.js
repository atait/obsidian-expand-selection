const { Plugin, Modal, Notice, FuzzySuggestModal } = require("obsidian");

class JumpModal extends FuzzySuggestModal {
    constructor(app, items, instructions = [], onSelect) {
        super(app);
        this.items = items;
        this.onSelect = onSelect;
        this.setInstructions(instructions);
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

class ExpandSelectionModal extends Modal {
    constructor(app, onChoose) {
        super(app);
        this.onChoose = onChoose;
        this.buttonElements = [];
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "What to expand?" });

        ["Line", "Section", "Note"].forEach((label) => {
            const btn = contentEl.createEl("button", {
                text: label,
                cls: "mod-cta",
            });
            btn.style.margin = "6px 0";

            this.buttonClickHandler = () => {
                this.onChoose(label.toLowerCase());
                this.close();
            };

            btn.addEventListener("click", this.buttonClickHandler);
            this.buttonElements.push(btn);
        });
    }

    onClose() {
        // Clean up event listeners
        this.buttonElements.forEach(btn => {
            btn.removeEventListener("click", this.buttonClickHandler);
        });
        this.buttonElements = [];
        this.contentEl.empty();
    }
}

module.exports = class ExpandSelectionPlugin extends Plugin {
    onload() {
        console.log("Expand Selection plugin loaded");

        // 🔹 Choose modal using JumpModal
        this.addCommand({
            id: "expand-choose",
            name: "Expand: Choose Line / Section / Note",
            icon: "move-vertical",
            editorCallback: (editor) => {
                const opts = new Map([
                    ["Expand to Line", "line"],
                    ["Expand to Section", "section"],
                    ["Expand to Note", "note"]
                ]);

                new JumpModal(this.app, opts, [
                    { command: "↑↓", purpose: "to navigate" },
                    { command: "↵", purpose: "to choose" },
                    { command: "esc", purpose: "to dismiss" }
                ], (choice) => {
                    if (choice === "line") this.expandToLines(editor);
                    else if (choice === "section") this.expandToHeadingSection(editor);
                    else if (choice === "note") this.expandToNote(editor);
                }).open();
            },
        });

        // 🔹 Expand to Line
        this.addCommand({
            id: "expand-line",
            name: "Expand: Line",
            icon: "text-cursor-input",
            editorCallback: (editor) => {
                this.expandToLines(editor);
            },
        });

        // 🔹 Expand to Section
        this.addCommand({
            id: "expand-section",
            name: "Expand: Section",
            icon: "layout-list",
            editorCallback: (editor) => {
                this.expandToHeadingSection(editor);
            },
        });

        // 🔹 Expand to Note
        this.addCommand({
            id: "expand-note",
            name: "Expand: Note",
            icon: "file-text",
            editorCallback: (editor) => {
                this.expandToNote(editor);
            },
        });
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

    expandToNote(editor) {
        const lastLine = editor.lineCount() - 1;
        const selectAll = { anchor: { line: 0, ch: 0 }, head: { line: lastLine, ch: editor.getLine(lastLine).length } };
        editor.setSelections([selectAll]);
    }

    expandToHeadingSection(editor) {
        const cursor = editor.getCursor();
        const lineCount = editor.lineCount();
        const currentSelection = editor.listSelections()[0];

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

        // Find the nearest heading before the cursor
        let currentHeading = null;
        let currentIndex = -1;
        for (let i = headings.length - 1; i >= 0; i--) {
            if (headings[i].line <= cursor.line) {
                currentHeading = headings[i];
                currentIndex = i;
                break;
            }
        }

        if (!currentHeading) {
            new Notice("No enclosing section found.");
            return;
        }

        // Calculate current section boundaries
        const start = { line: currentHeading.line, ch: 0 };
        let endLine = lineCount - 1;
        for (let i = currentIndex + 1; i < headings.length; i++) {
            if (headings[i].level <= currentHeading.level) {
                endLine = Math.max(0, headings[i].line - 1);
                break;
            }
        }
        const end = { line: endLine, ch: editor.getLine(endLine).length };

        // Check if current selection already matches this section
        if (currentSelection &&
            currentSelection.anchor.line === start.line &&
            currentSelection.anchor.ch === start.ch &&
            currentSelection.head.line === end.line &&
            currentSelection.head.ch === end.ch) {

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
                const parentStart = { line: parentHeading.line, ch: 0 };
                let parentEndLine = lineCount - 1;
                for (let i = parentIndex + 1; i < headings.length; i++) {
                    if (headings[i].level <= parentHeading.level) {
                        parentEndLine = Math.max(0, headings[i].line - 1);
                        break;
                    }
                }
                const parentEnd = { line: parentEndLine, ch: editor.getLine(parentEndLine).length };
                editor.setSelection(parentStart, parentEnd);
            } else {
                // No parent, select entire note
                const lastLine = lineCount - 1;
                editor.setSelection({ line: 0, ch: 0 }, { line: lastLine, ch: editor.getLine(lastLine).length });
            }
        } else {
            // Select current section
            editor.setSelection(start, end);
        }
    }

    onunload() {
        console.log("Expand Selection plugin unloaded");
    }
};
