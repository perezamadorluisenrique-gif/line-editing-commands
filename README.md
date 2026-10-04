# Line Editing Commands

Line-level editing commands for Obsidian's editor: duplicate, join, sort, reverse, insert blank lines, select a line, delete to the start or end of a line, and jump to a line number. Every command works with several cursors at once, and a single **Undo** reverts it.

Obsidian already has commands to swap a line up or down, add a cursor above or below, delete a paragraph and toggle lists, so this plugin only adds what is missing.

## Commands

| Command | What it does |
|---|---|
| Duplicate line or selection down / up | Copies the selected lines (or the line with the cursor) below or above. Down moves your selection to the copy; up keeps it on the upper copy. |
| Insert blank line below / above | Adds an empty line next to the cursor's line, keeping its indentation, and puts the cursor on it. |
| Select line (repeat to extend) | Selects the whole line. Run it again to add the next line. |
| Join lines | Joins the cursor's line with the next one, or all selected lines, with a single space. The indentation of each joined line is dropped; empty lines are skipped. |
| Sort selected lines (A to Z) / (Z to A) | Sorts the selected lines. Ignores case and compares numbers by value, so `item2` comes before `item10`. |
| Reverse selected lines | Reverses the order of the selected lines. |
| Remove duplicate lines in selection | Keeps the first of each repeated line. |
| Delete to line start / end | Deletes from the cursor to the start or end of its line. |
| Go to line number | Opens a small window. Type `42` or `42:7` (line and column). A number past the end goes to the last line. |

Sort, reverse and remove-duplicates need a selection that spans more than one line; they never touch a single line. A selection that ends at the very start of a line does not include that line. Where several cursors share a line, that line is edited once.

There are no default hotkeys, so nothing clashes with your own. Assign them in **Settings → Hotkeys**. Suggested starting points, if you are coming from other editors:

| Command | Suggestion |
|---|---|
| Duplicate line down / up | `Ctrl+Shift+D` / `Ctrl+Alt+Shift+D` |
| Join lines | `Ctrl+J` |
| Select line | `Ctrl+L` |
| Go to line number | `Ctrl+G` |

## Notes

- Nothing is sent over the network and the plugin has no settings.
- It works in the editor only (Source mode and Live Preview), on desktop and mobile.

## Installation

In Obsidian, open **Settings → Community plugins → Browse** and search for "Line Editing Commands".
