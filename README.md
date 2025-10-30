# Expand Selection Obsidian Plugin

An Obsidian plugin to expand your editor selection to lines, sections (recursive), or the entire note.

This plugin is primarily designed for *mobile* convenience. "Expand to Section" is useful on desktop as well. Multiple cursors are supported.

## Expand to Section
Run this command to select the entire section the cursor is in or that the current selection is in. Run the command again to expand to the parent section.


![Expand to Section](https://github.com/atait/obsidian-expand-selection/raw/main/assets/expand-selection-demo.gif)


This feature is useful when you want to perform operations on an entire section at once, such as reformatting, copying, or moving to a different place in your vault.

## Smart Expand
This single command replaces the need for the others.

- Smart Expand is line expansion by default.
- If the selection is already a line, it expands to the section.
- If the selection is already a section, it expands to the parent.
- Eventually, it will expand to the note.

## Registered Commands

Each mode is exposed as a separate command, so you can assign different hotkeys and add them to your mobile toolbar.

- `Expand Selection: Line`
- `Expand Selection: Section`
- `Expand Selection: Note`
- `Expand Selection: Modal`
- `Expand Selection: Smart Expand`

---

Author: Alex Tait

License: MIT