# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## Unreleased

- Multiple cursors the way code editors do them: select word or next occurrence, select all occurrences, skip an occurrence, add cursor above or below, and keep only the main cursor. They only move selections and never change your note.

## 0.1.1

- Rebuilt from the public repository so the build provenance attestation of main.js verifies.

## 0.1.0

- First release: duplicate lines up and down, insert blank lines, select line, join lines, sort, reverse and de-duplicate selected lines, delete to line start or end, and go to line number. All multi-cursor aware, one undo step each.
