/**
 * Auto Archive Completed Tasks - Obsidian Plugin
 * Copyright (c) 2025 danielhsfox
 * @license MIT
 *
 * Behavior: completed tasks are moved to the END of the same list they belong to,
 * not to a global section. A timestamp line is inserted below the task.
 * Requires `automove: true` in the note's frontmatter.
 */
import { App, Editor, Notice, Plugin, TFile } from 'obsidian';
import moment from 'moment';

// ─── Constants ────────────────────────────────────────────────────────────────

const DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const ICON = '✅';
const DELAY_MS = 300;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getIndentLevel(line: string): number {
    const m = line.match(/^[\s\t]*/);
    return m ? m[0].length : 0;
}

/** Returns true if `line` is a checkbox task (checked or unchecked). */
function isCheckboxLine(line: string): boolean {
    return /^- \[[ x]\]\s/i.test(line.trim());
}

/** Returns true if the checkbox is checked [x]. */
function isChecked(line: string): boolean {
    return /^- \[x\]\s/i.test(line.trim());
}

/** Returns true if the line already carries a timestamp appended by this plugin. */
function hasTimestamp(line: string): boolean {
    const pattern = new RegExp(`${escapeRegExp(ICON)}\\s*\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}`);
    return pattern.test(line);
}

/** Parse `automove: true` from YAML frontmatter. */
function hasAutoMoveEnabled(content: string): boolean {
    const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fm || !fm[1]) return false;
    for (const line of fm[1].split('\n')) {
        const t = line?.trim();
        if (!t) continue;
        if (t.toLowerCase().startsWith('automove:')) {
            const val = t.split(':').slice(1).join(':').trim();
            return /^("|')?true("|')?$/i.test(val);
        }
    }
    return false;
}

// ─── Core: find the "list block" a task belongs to ───────────────────────────

/**
 * A "list block" is a contiguous run of lines that belong to the same
 * Markdown list (tasks, plain bullets, or their sub-items) identified by
 * a shared top-level indent of 0 and no blank line separating them from
 * neighbours that are also list items at indent 0.
 *
 * We locate the block by walking up/down from `taskLine` while consecutive
 * lines are either:
 *   - non-empty list items at indent >= 0, OR
 *   - non-empty non-heading lines that are continuations / timestamps
 *
 * Returns { start, end } line numbers (inclusive).
 */
function findListBlock(editor: Editor, taskLine: number): { start: number; end: number } {
    const total = editor.lineCount();

    // Walk upward to find the first line of the block
    let start = taskLine;
    while (start > 0) {
        const prev = editor.getLine(start - 1);
        if (prev.trim() === '') break;              // blank line ends the block
        if (/^#{1,6}\s/.test(prev.trim())) break;  // heading ends the block
        start--;
    }

    // Walk downward to find the last line of the block
    let end = taskLine;
    while (end + 1 < total) {
        const next = editor.getLine(end + 1);
        if (next.trim() === '') break;
        if (/^#{1,6}\s/.test(next.trim())) break;
        end++;
    }

    return { start, end };
}

/**
 * Within a list block find the last line that is a top-level list item
 * (indent === 0) OR its direct continuation (timestamp line, sub-items).
 * This is where we will append the moved task.
 */
function findInsertionPointInBlock(editor: Editor, blockEnd: number): number {
    // The insertion point is simply after the last line of the block.
    // We return blockEnd + 1 so the caller can do replaceRange at that line.
    return blockEnd + 1;
}

// ─── Core: task block extraction ─────────────────────────────────────────────

/**
 * Returns the lines to INSERT for the task at `lineIndex` (task line +
 * indented sub-items + timestamp), plus `originalLineCount` — the number
 * of lines to DELETE from the editor (which may include a pre-existing
 * same-indent timestamp line sitting just after the task).
 */
function extractTaskBlock(
    editor: Editor,
    lineIndex: number
): { blockLines: string[]; originalLineCount: number } {
    const mainLine = editor.getLine(lineIndex);
    const mainIndent = getIndentLevel(mainLine);
    const lines: string[] = [mainLine];

    let i = lineIndex + 1;

    // 1. Collect indented sub-items
    while (i < editor.lineCount()) {
        const l = editor.getLine(i);
        if (l.trim() !== '' && getIndentLevel(l) > mainIndent) {
            lines.push(l);
            i++;
        } else {
            break;
        }
    }

    // 2. Check whether the very next line is an existing timestamp for this task
    //    (same indent, starts with ICON). Grab it so it isn't orphaned.
    let existingTimestampLine: string | null = null;
    if (i < editor.lineCount()) {
        const candidate = editor.getLine(i);
        if (
            getIndentLevel(candidate) === mainIndent &&
            candidate.trim().startsWith(ICON) &&
            hasTimestamp(candidate)
        ) {
            existingTimestampLine = candidate;
            i++;
        }
    }

    // originalLineCount = task line + sub-items + existing timestamp (if any)
    const originalLineCount = i - lineIndex;

    // 3. Append timestamp: reuse existing one or generate fresh
    if (existingTimestampLine) {
        lines.push(existingTimestampLine);
    } else {
        const indent = mainLine.match(/^\s*/)?.[0] ?? '';
        lines.push(`${indent}${ICON} ${moment().format(DATE_FORMAT)}`);
    }

    return { blockLines: lines, originalLineCount };
}

/**
 * Remove `count` lines starting at `lineIndex` from the editor.
 */
function removeLinesFromEditor(editor: Editor, lineIndex: number, count: number): void {
    const total = editor.lineCount();
    const endLine = Math.min(lineIndex + count, total);
    editor.replaceRange(
        '',
        { line: lineIndex, ch: 0 },
        { line: endLine, ch: 0 }
    );
}

// ─── Core: detect which tasks need to be moved ───────────────────────────────

interface TaskToMove {
    /** Line number of the task's first line (before any removal). */
    line: number;
    /** All lines to insert (task + optional sub-items + timestamp). */
    blockLines: string[];
    /**
     * How many lines to DELETE from the editor at `line`.
     * May be > blockLines.length when an existing timestamp line was
     * already in the editor and gets re-included in blockLines.
     */
    originalLineCount: number;
}

function detectTasksToMove(editor: Editor): TaskToMove[] {
    const total = editor.lineCount();
    const tasks: TaskToMove[] = [];
    const alreadyInBlock = new Set<number>();

    for (let i = 0; i < total; i++) {
        if (alreadyInBlock.has(i)) continue;

        const originalLine = editor.getLine(i);
        if (!isCheckboxLine(originalLine)) continue;
        if (!isChecked(originalLine)) continue;
        if (hasTimestamp(originalLine)) continue;

        const indent = getIndentLevel(originalLine);
        // Only move top-level tasks (indent === 0); subtasks travel with parent
        if (indent > 0) continue;

        const { blockLines, originalLineCount } = extractTaskBlock(editor, i);

        // Mark all original editor lines so we don't re-process sub-items
        for (let j = i; j < i + originalLineCount; j++) {
            alreadyInBlock.add(j);
        }

        tasks.push({ line: i, blockLines, originalLineCount });
    }

    return tasks;
}

// ─── Main processing ─────────────────────────────────────────────────────────

async function processNoteEditor(editor: Editor): Promise<void> {
    const cursor = editor.getCursor();
    const scroll = editor.getScrollInfo();

    const tasks = detectTasksToMove(editor);

    if (tasks.length === 0) {
        new Notice('📭 No completed tasks to process');
        return;
    }

    // Process tasks from BOTTOM to TOP so line numbers above don't shift
    // when we remove lines.
    const sorted = [...tasks].sort((a, b) => b.line - a.line);

    let movedCount = 0;

    for (const task of sorted) {
        // 1. Snapshot current list block boundaries BEFORE removal
        const { start: blockStart, end: blockEnd } = findListBlock(editor, task.line);

        // 2. Remove the task (+ existing timestamp if any) from its original position
        removeLinesFromEditor(editor, task.line, task.originalLineCount);

        // 3. Recalculate block end after removal (block shrunk by originalLineCount)
        const newBlockEnd = blockEnd - task.originalLineCount;

        // 4. Insert at end of block
        const insertAt = newBlockEnd + 1;
        const textToInsert = task.blockLines.join('\n') + '\n';

        editor.replaceRange(
            textToInsert,
            { line: insertAt, ch: 0 },
            { line: insertAt, ch: 0 }
        );

        movedCount++;
    }

    // Restore cursor & scroll (best-effort)
    const lineCount = editor.lineCount();
    const safeLine = Math.min(cursor.line, lineCount - 1);
    editor.setCursor({ line: Math.max(0, safeLine), ch: cursor.ch });
    editor.scrollTo(scroll.left, scroll.top);

    const msg = movedCount === 1
        ? '✅ 1 task archived to end of its list'
        : `✅ ${movedCount} tasks archived to end of their lists`;
    new Notice(msg, 3000);
}

// ─── Plugin class ─────────────────────────────────────────────────────────────

export default class AutoArchiveTaskPlugin extends Plugin {
    private isProcessing = false;

    async onload() {
        // Manual trigger command
        this.addCommand({
            id: 'move-completed-tasks',
            name: 'Archive completed tasks to end of their list',
            callback: () => this.processCurrentNote(),
        });

        // Auto-trigger on checkbox click (preview mode)
        this.setupCheckboxListener();
    }

    onunload() {}

    // ── Checkbox listener ──────────────────────────────────────────────────

    private setupCheckboxListener(): void {
        this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;
            if (
                target.tagName === 'INPUT' &&
                (target as HTMLInputElement).type === 'checkbox' &&
                target.classList.contains('task-list-item-checkbox')
            ) {
                setTimeout(() => this.handleCheckboxClick(target as HTMLInputElement), DELAY_MS);
            }
        });
    }

    private async handleCheckboxClick(checkbox: HTMLInputElement): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) return;

            const content = await this.app.vault.read(activeFile);
            if (!hasAutoMoveEnabled(content)) return;

            const activeLeaf = this.app.workspace.activeLeaf;
            const viewState = activeLeaf?.getViewState();
            const isPreview = viewState?.state?.mode === 'preview';

            // In source mode, only react when checkbox is now checked
            if (!isPreview && !checkbox.checked) return;

            let originalViewState = isPreview ? viewState : null;

            // Switch to source mode if needed
            if (isPreview) {
                await activeLeaf?.setViewState({
                    ...viewState,
                    state: { ...viewState?.state, mode: 'source' },
                });
                await sleep(50);
            }

            const editor = this.app.workspace.activeEditor?.editor;
            if (editor) await processNoteEditor(editor);

            // Return to preview if we switched
            if (originalViewState) {
                await sleep(100);
                await activeLeaf?.setViewState(originalViewState);
            }
        } catch (err) {
            console.error('[AutoArchive] handleCheckboxClick error:', err);
        } finally {
            setTimeout(() => { this.isProcessing = false; }, 300);
        }
    }

    // ── Manual command ─────────────────────────────────────────────────────

    private async processCurrentNote(): Promise<void> {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                new Notice('📭 No active note');
                return;
            }

            const content = await this.app.vault.read(activeFile);
            if (!hasAutoMoveEnabled(content)) {
                new Notice('📭 Add `automove: true` to this note\'s frontmatter');
                return;
            }

            const activeLeaf = this.app.workspace.activeLeaf;
            const viewState = activeLeaf?.getViewState();
            const isPreview = viewState?.state?.mode === 'preview';
            let originalViewState = isPreview ? viewState : null;

            if (isPreview) {
                await activeLeaf?.setViewState({
                    ...viewState,
                    state: { ...viewState?.state, mode: 'source' },
                });
                await sleep(50);
            }

            const editor = this.app.workspace.activeEditor?.editor;
            if (editor) {
                await processNoteEditor(editor);
            } else {
                new Notice('❌ Could not access editor');
            }

            if (originalViewState) {
                await sleep(100);
                await activeLeaf?.setViewState(originalViewState);
            }
        } catch (err) {
            console.error('[AutoArchive] processCurrentNote error:', err);
            new Notice('❌ Error processing note');
        }
    }
}

// ─── Tiny async sleep helper ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}