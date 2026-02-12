/**
 * Dynamic Note Creator - Obsidian Plugin
 * Copyright (c) 2025 danielhsfox
 * @license MIT
 */
import { App, Editor, EditorPosition, EditorScrollInfo, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import moment from 'moment';

interface AutoArchiveTaskSettings {
    dateFormat: string;
    icon: string;
    autoMove: boolean;
    createSection: boolean;
    sectionTitle: string;
    addSeparator: boolean;
    delay: number;
    autoSwitchToEditMode: boolean;
    returnToViewMode: boolean;
}

const DEFAULT_SETTINGS: AutoArchiveTaskSettings = {
    dateFormat: 'YYYY-MM-DD HH:mm:ss',
    icon: '✅',
    autoMove: true,
    createSection: true,
    sectionTitle: '## Completed Tasks',
    addSeparator: true,
    delay: 300,
    autoSwitchToEditMode: true,
    returnToViewMode: false
};

interface CheckboxChange {
    line: number;
    text?: string;
    originalText: string;
    originalLine: string;
    lineCount?: number;
    blockLines?: number;
}

interface ChangesDetected {
    completedIndividual: CheckboxChange[];
    completedSubtasks: CheckboxChange[];
    completedMainWithSubtasks: CheckboxChange[];
    unchecked: CheckboxChange[];
}

interface TaskToMove {
    type: 'individual' | 'withSubtasks';
    line: number;
    text: string;
    originalLine: string;
    originalText: string;
    lineCount: number;
}

interface SectionRange {
    start: number;
    end: number;
}

interface InsertionPoint {
    line: number;
}

export default class AutoArchiveTaskPlugin extends Plugin {
    settings: AutoArchiveTaskSettings;
    isProcessing: boolean = false;

	// ✅ Almacenar timestamps agregados para evitar duplicados
    private processedTaskIds: Set<string> = new Set();
    
    // ✅ Limpiar después de cada operación exitosa
    private clearProcessedTasks() {
        setTimeout(() => {
            this.processedTaskIds.clear();
        }, 5000); // Limpiar después de 5 segundos
    }

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'move-completed-tasks',
            name: 'Move completed tasks to the end',
            callback: () => {
                this.processCurrentNote();
            }
        });

        this.addCommand({
            id: 'clear-completed-section',
            name: 'Clear completed tasks section',
            callback: () => {
                this.clearCurrentNoteSection();
            }
        });

        if (this.settings.autoMove) {
            this.setupCheckboxListener();
        }

        this.addSettingTab(new AutoArchiveSettingTab(this.app, this));
    }

    setupCheckboxListener() {
        this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
            const target = evt.target as HTMLElement;

            if (target.tagName === 'INPUT' && 
                (target as HTMLInputElement).type === 'checkbox' && 
                target.classList.contains('task-list-item-checkbox')) {

                setTimeout(() => {
                    this.handleCheckboxClick(target as HTMLInputElement);
                }, this.settings.delay);
            }
        });
    }

 async handleCheckboxClick(checkbox: HTMLInputElement) {

	 // 🚫 Ignorar clicks en checkboxes que YA están en la sección de completadas
    const isInCompletedSection = checkbox.closest('.markdown-source-view')?.querySelector('h2')?.textContent?.includes('Completed');
    if (isInCompletedSection) {
        return;
    }

    const executionId = Math.random().toString(36).substring(7);
    
    // 🚨 BLOQUEO INMEDIATO - SIN setTimeout
    if (this.isProcessing) {
        console.log(`⏸️ [${executionId}] YA PROCESANDO - IGNORADO`);
        return;
    }
    
    this.isProcessing = true;
    console.log(`🚀 [${executionId}] HANDLECHECKBOXCLICK INICIADO`);
    
    try {
        this.processedTaskIds.clear();
        
        if (!this.settings.autoMove) return;
        
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;
        
        const fileContent = await this.app.vault.read(activeFile);
        const hasAutoMove = this.hasAutoMoveEnabled(fileContent);
        if (!hasAutoMove) return;
        
        const activeLeaf = this.app.workspace.activeLeaf;
        const viewState = activeLeaf?.getViewState();
        const isViewMode = viewState?.state?.mode === 'preview';
        
        if (!isViewMode && !checkbox.checked) return;
        
        let wasInViewMode = false;
        let originalViewState = null;
        
        if (isViewMode && this.settings.autoSwitchToEditMode) {
            wasInViewMode = true;
            originalViewState = viewState;
            
            await activeLeaf?.setViewState({
                ...originalViewState,
                state: { ...originalViewState?.state, mode: 'source' }
            });
            
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) {
            await this.processNoteEditor(editor);
        }
        
        if (wasInViewMode && this.settings.returnToViewMode && originalViewState) {
            await new Promise(resolve => setTimeout(resolve, 100));
            await activeLeaf?.setViewState(originalViewState);
        }
        
        console.log(`✅ [${executionId}] COMPLETADO`);
        
    } catch (error) {
        console.error(`❌ [${executionId}] Error:`, error);
    } finally {
        // 🔓 Liberar después de 1 segundo
        setTimeout(() => {
            this.isProcessing = false;
            console.log(`   🔓 [${executionId}] isProcessing liberado`);
        }, 1000);
    }
}

    async processCurrentNote() {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                new Notice('📭 No active note');
                return;
            }

            const fileContent = await this.app.vault.read(activeFile);
            const hasAutoMove = this.hasAutoMoveEnabled(fileContent);

            if (!hasAutoMove) {
                new Notice('📭 This note does not have automove: true in frontmatter');
                return;
            }

            const activeLeaf = this.app.workspace.activeLeaf;
            const viewState = activeLeaf?.getViewState();
            const isViewMode = viewState?.state?.mode === 'preview';

            let wasInViewMode = false;
            let originalViewState = null;

            if (isViewMode) {
                wasInViewMode = true;
                originalViewState = viewState;

                await activeLeaf?.setViewState({
                    ...originalViewState,
                    state: { ...originalViewState?.state, mode: 'source' }
                });

                await new Promise(resolve => setTimeout(resolve, 50));
            }

            const editor = this.app.workspace.activeEditor?.editor;
            if (editor) {
                await this.processNoteEditor(editor);
            } else {
                new Notice('❌ Could not get editor');
            }

            if (wasInViewMode && this.settings.returnToViewMode && originalViewState) {
                await new Promise(resolve => setTimeout(resolve, 100));
                await activeLeaf?.setViewState(originalViewState);
            }

        } catch (error) {
            console.error('Error in processCurrentNote:', error);
            new Notice('❌ Error processing note');
        }
    }

    async processNoteEditor(editor: Editor) {
        try {
            const originalCursor = editor.getCursor();
            const scroll = editor.getScrollInfo();

            const changes = this.detectCheckboxChanges(editor);

            const hasChanges = changes.completedIndividual.length > 0 || 
                              changes.completedSubtasks.length > 0 || 
                              changes.completedMainWithSubtasks.length > 0;

            if (!hasChanges) {
                new Notice('📭 No completed tasks to process');
                return;
            }

            let movedCount = 0;
            let subtaskTimestampCount = 0;


            // Collect tasks to move
            const tasksToMove: TaskToMove[] = [];

			// Individual tasks
			for (const change of changes.completedIndividual) {
				const indentSpaces = change.originalLine.match(/^\s*/)?.[0] || '';
				const timestamp = moment().format(this.settings.dateFormat);
				const icon = this.settings.icon;
				const taskWithTimestamp = `${change.originalLine}\n${indentSpaces}${icon} ${timestamp}`;

				tasksToMove.push({
					type: 'individual',
					line: change.line,
					text: taskWithTimestamp,
					originalLine: change.originalLine,
					originalText: change.originalText,
					lineCount: 2
				});
			}

			// Tasks with subtasks
			for (const change of changes.completedMainWithSubtasks) {
				const blockText = this.getTaskBlockWithTimestamp(editor, change.line);
				const lineCount = blockText.split('\n').length;
				tasksToMove.push({
					type: 'withSubtasks',
					line: change.line,
					text: blockText,
					originalLine: change.originalLine,
					originalText: change.originalText,
					lineCount: lineCount
				});
			}

			// Si solo hay subtasks procesadas
			if (tasksToMove.length === 0) {
				editor.setCursor(originalCursor);
				editor.scrollTo(scroll.left, scroll.top);
				
				if (changes.completedSubtasks.length > 0) {
					const msg = changes.completedSubtasks.length === 1
						? '✅ Timestamp added to 1 subtask'
						: `✅ Timestamp added to ${changes.completedSubtasks.length} subtasks`;
					new Notice(msg, 3000);
				}
				return;
			}

            // Sort by line (descending) for removal
            tasksToMove.sort((a, b) => b.line - a.line);

            // Calculate new cursor position
            let newCursorLine = originalCursor.line;
            let cursorWasInMovedTask = false;

            for (const task of tasksToMove) {
                if (task.type === 'individual' && task.line === originalCursor.line) {
                    cursorWasInMovedTask = true;
                    break;
                } else if (task.type === 'withSubtasks') {
                    let endLine = task.line;
                    while (endLine + 1 < editor.lineCount()) {
                        const nextLine = editor.getLine(endLine + 1);
                        const nextIndent = this.getIndentLevel(nextLine);
                        if (nextIndent > 0) {
                            endLine++;
                        } else {
                            break;
                        }
                    }

                    if (originalCursor.line >= task.line && originalCursor.line <= endLine) {
                        cursorWasInMovedTask = true;
                        break;
                    }
                }
            }

            if (cursorWasInMovedTask) {
                newCursorLine = originalCursor.line;
            } else {
                let linesRemovedAboveCursor = 0;
                for (const task of tasksToMove) {
                    if (task.line < originalCursor.line) {
                        linesRemovedAboveCursor += task.lineCount;
                    }
                }
                newCursorLine = originalCursor.line - linesRemovedAboveCursor;
            }

            // Remove tasks from original positions
            for (const task of tasksToMove) {
                this.removeTaskFromOriginalPosition(editor, task.line, task.type);
                movedCount++;
            }

            // Get insertion point in completed section
            const insertionPoint = await this.findOrCreateCompletedSection(editor);
            const lineAtInsertion = editor.getLine(insertionPoint.line);

            // Sort tasks by original line (ascending) for chronological order
            tasksToMove.sort((a, b) => a.line - b.line);

            // Insert tasks in completed section
            let currentInsertionLine = insertionPoint.line;

            if (lineAtInsertion.trim() !== '' && !/^- \[[ x]\]/.test(lineAtInsertion)) {
                editor.replaceRange(
                    '\n',
                    { line: currentInsertionLine, ch: 0 },
                    { line: currentInsertionLine, ch: 0 }
                );
                currentInsertionLine++;
            }

            for (const task of tasksToMove) {
                editor.replaceRange(
                    task.text + '\n',
                    { line: currentInsertionLine, ch: 0 },
                    { line: currentInsertionLine, ch: 0 }
                );
                currentInsertionLine += task.lineCount;
            }

            // Position cursor correctly
            if (cursorWasInMovedTask) {
                const lineCount = editor.lineCount();
                if (newCursorLine >= lineCount) {
                    newCursorLine = Math.max(0, lineCount - 1);
                }

                let currentLineText = editor.getLine(newCursorLine);
                while (currentLineText.trim() === '' && newCursorLine > 0) {
                    newCursorLine--;
                    currentLineText = editor.getLine(newCursorLine);
                }

                if (currentLineText.trim() === '') {
                    newCursorLine = 0;
                    currentLineText = editor.getLine(newCursorLine);
                }

                const cursorCh = currentLineText.length;

                editor.setCursor({
                    line: newCursorLine,
                    ch: cursorCh
                });
            } else {
                editor.setCursor({
                    line: newCursorLine,
                    ch: originalCursor.ch
                });
            }

            editor.scrollTo(scroll.left, scroll.top);

            // Show summary notification
            let msg = '';
            if (movedCount > 0 && subtaskTimestampCount > 0) {
                msg = `✅ ${movedCount} tasks moved and ${subtaskTimestampCount} subtasks timestamped`;
            } else if (movedCount > 0) {
                msg = movedCount === 1 
                    ? '✅ 1 task moved to the end' 
                    : `✅ ${movedCount} tasks moved to the end`;
            } else if (subtaskTimestampCount > 0) {
                msg = subtaskTimestampCount === 1
                    ? '✅ Timestamp added to 1 subtask'
                    : `✅ Timestamp added to ${subtaskTimestampCount} subtasks`;
            }

            if (msg) {
                new Notice(msg, 3000);
            }

        } catch (error) {
            console.error('Error in processNoteEditor:', error);
            throw error;
        }
    }

getTaskBlockWithTimestamp(editor: Editor, lineIndex: number): string {
    const originalIndent = this.getIndentLevel(editor.getLine(lineIndex));
    
    let endLineIndex = lineIndex;
    
    while (endLineIndex + 1 < editor.lineCount()) {
        const nextLine = editor.getLine(endLineIndex + 1);
        const nextIndent = this.getIndentLevel(nextLine);
        
        if (nextIndent > originalIndent) {
            endLineIndex++;
        } else {
            break;
        }
    }
    
    const blockLines: string[] = [];
    for (let i = lineIndex; i <= endLineIndex; i++) {
        blockLines.push(editor.getLine(i));
    }
    
    // ✅ SOLO añadir timestamp si la tarea principal NO lo tiene
    const mainLine = editor.getLine(lineIndex);
    const icon = this.settings.icon;
    const timestampPattern = new RegExp(`${this.escapeRegExp(icon)}\\s*\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}`);
    
    if (!timestampPattern.test(mainLine)) {
        const indentSpaces = mainLine.match(/^\s*/)?.[0] || '';
        const timestamp = moment().format(this.settings.dateFormat);
        const timestampLine = `${indentSpaces}${icon} ${timestamp}`;
        blockLines.push(timestampLine);
    }
    
    return blockLines.join('\n');
}

    removeTaskFromOriginalPosition(editor: Editor, lineIndex: number, taskType: string): void {
        try {
            if (taskType === 'individual') {
                const lineText = editor.getLine(lineIndex);

                if (lineIndex + 1 < editor.lineCount()) {
                    const nextLine = editor.getLine(lineIndex + 1);
                    const indentSpaces = lineText.match(/^\s*/)?.[0] || '';
                    const icon = this.settings.icon;
                    const timestampPattern = new RegExp(`^${this.escapeRegExp(indentSpaces)}${this.escapeRegExp(icon)}\\s`);

                    if (timestampPattern.test(nextLine)) {
                        editor.replaceRange(
                            '',
                            { line: lineIndex, ch: 0 },
                            { line: lineIndex + 2, ch: 0 }
                        );
                    } else {
                        editor.replaceRange(
                            '',
                            { line: lineIndex, ch: 0 },
                            { line: lineIndex + 1, ch: 0 }
                        );
                    }
                } else {
                    editor.replaceRange(
                        '',
                        { line: lineIndex, ch: 0 },
                        { line: lineIndex + 1, ch: 0 }
                    );
                }

            } else if (taskType === 'withSubtasks') {
                const originalIndent = this.getIndentLevel(editor.getLine(lineIndex));

                let endLineIndex = lineIndex;

                while (endLineIndex + 1 < editor.lineCount()) {
                    const nextLine = editor.getLine(endLineIndex + 1);
                    const nextIndent = this.getIndentLevel(nextLine);

                    if (nextIndent > originalIndent) {
                        endLineIndex++;
                    } else {
                        break;
                    }
                }

                editor.replaceRange(
                    '',
                    { line: lineIndex, ch: 0 },
                    { line: endLineIndex + 1, ch: 0 }
                );
            }

        } catch (error) {
            console.error('Error removing task:', error);
        }
    }

    hasSubtasks(editor: Editor, lineIndex: number): boolean {
        const currentIndent = this.getIndentLevel(editor.getLine(lineIndex));
        let nextLineIndex = lineIndex + 1;

        while (nextLineIndex < editor.lineCount()) {
            const nextLine = editor.getLine(nextLineIndex);

            if (nextLine.trim() === '') {
                nextLineIndex++;
                continue;
            }

            const nextIndent = this.getIndentLevel(nextLine);

            if (nextIndent > currentIndent && /^- \[[ x]\]\s/i.test(nextLine.trim())) {
                return true;
            }

            if (nextIndent <= currentIndent) {
                break;
            }

            nextLineIndex++;
        }

        return false;
    }

    getIndentLevel(line: string): number {
        const match = line.match(/^[\s\t]*/);
        return match ? match[0].length : 0;
    }

    escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

async findOrCreateCompletedSection(editor: Editor): Promise<InsertionPoint> {
    const sectionTitle = this.settings.sectionTitle;
    const content = editor.getValue();
    const lines = content.split('\n');

    // Find existing section
    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i];
        if (!currentLine) continue;
        
        if (currentLine.trim() === sectionTitle.trim()) {
            let currentLineIndex = i + 1;

            if (currentLineIndex < lines.length) {
                const nextLine = lines[currentLineIndex];
                if (nextLine?.trim() === '---') {
                    currentLineIndex++;
                }
            }

            let lastContentLine = currentLineIndex;

            while (lastContentLine < lines.length) {
                const line = lines[lastContentLine];
                if (!line) break;
                
                const trimmed = line.trim();
                if (trimmed === '' || trimmed.startsWith('#')) {
                    break;
                }
                lastContentLine++;
            }

            return { line: lastContentLine };
        }
    }

    // Create new section if enabled
    if (this.settings.createSection) {
        const insertionLine = lines.length;
        const separator = this.settings.addSeparator ? '\n---\n' : '\n\n';
        const sectionContent = '\n\n' + sectionTitle + separator;

        editor.replaceRange(
            sectionContent,
            { line: insertionLine, ch: 0 },
            { line: insertionLine, ch: 0 }
        );

        const finalLine = this.settings.addSeparator ? insertionLine + 3 : insertionLine + 2;
        return { line: finalLine };
    }

    return { line: lines.length };
}

    async clearCurrentNoteSection() {
        try {
            const activeFile = this.app.workspace.getActiveFile();
            if (!activeFile) {
                new Notice('📭 No active note');
                return;
            }

            const fileContent = await this.app.vault.read(activeFile);
            const hasAutoMove = this.hasAutoMoveEnabled(fileContent);

            if (!hasAutoMove) {
                new Notice('📭 This note does not have automove: true in frontmatter');
                return;
            }

            const activeLeaf = this.app.workspace.activeLeaf;
            const viewState = activeLeaf?.getViewState();
            const isViewMode = viewState?.state?.mode === 'preview';

            let wasInViewMode = false;
            let originalViewState = null;

            if (isViewMode) {
                wasInViewMode = true;
                originalViewState = viewState;

                await activeLeaf?.setViewState({
                    ...originalViewState,
                    state: { ...originalViewState?.state, mode: 'source' }
                });

                await new Promise(resolve => setTimeout(resolve, 50));
            }

            const editor = this.app.workspace.activeEditor?.editor;
            if (editor) {
                await this.clearCompletedSection(editor);
            } else {
                new Notice('❌ Could not get editor');
            }

            if (wasInViewMode && this.settings.returnToViewMode && originalViewState) {
                await new Promise(resolve => setTimeout(resolve, 100));
                await activeLeaf?.setViewState(originalViewState);
            }

        } catch (error) {
            console.error('Error in clearCurrentNoteSection:', error);
            new Notice('❌ Error clearing section');
        }
    }

hasAutoMoveEnabled(fileContent: string): boolean {
    const frontmatterMatch = fileContent.match(/^---\s*\n([\s\S]*?)\n---/);

    if (!frontmatterMatch) {
        return false;
    }

    const frontmatter = frontmatterMatch[1];
    if (!frontmatter) return false;
    
    const lines = frontmatter.split('\n');

    for (const line of lines) {
        const trimmedLine = line?.trim();
        if (!trimmedLine) continue;
        
        if (trimmedLine.toLowerCase().startsWith('automove:')) {
            const parts = trimmedLine.split(':');
            if (parts.length >= 2) {
                const value = parts.slice(1).join(':').trim();
                const isTrue = /^("|')?true("|')?$/i.test(value);
                return isTrue;
            }
        }
    }

    return false;
}

async clearCompletedSection(editor: Editor) {
    try {
        const sectionTitle = this.settings.sectionTitle;
        const content = editor.getValue();
        const lines = content.split('\n');

        let sectionStart = -1;
        let sectionEnd = -1;

        for (let i = 0; i < lines.length; i++) {
            const currentLine = lines[i];
            if (!currentLine) continue;
            
            if (currentLine.trim() === sectionTitle.trim()) {
                sectionStart = i;
                sectionEnd = i + 1;
                
                while (sectionEnd < lines.length) {
                    const line = lines[sectionEnd];
                    if (!line) break;
                    
                    const trimmed = line.trim();
                    if (trimmed === '' || trimmed.startsWith('#')) {
                        break;
                    }
                    sectionEnd++;
                }
                break;
            }
        }

        if (sectionStart === -1) {
            new Notice('📭 No completed tasks section found');
            return;
        }

        const cursor = editor.getCursor();
        const scroll = editor.getScrollInfo();

        if (sectionEnd > sectionStart + 1) {
            editor.replaceRange(
                '',
                { line: sectionStart + 1, ch: 0 },
                { line: sectionEnd, ch: 0 }
            );
            new Notice('🧹 Completed tasks section cleared', 2000);
        } else {
            new Notice('📭 Section is already empty', 2000);
        }

        editor.setCursor(cursor);
        editor.scrollTo(scroll.left, scroll.top);

    } catch (error) {
        console.error('Error clearing section:', error);
        throw error;
    }
}

detectCheckboxChanges(editor: Editor): ChangesDetected {
    const changes: ChangesDetected = {
        completedIndividual: [],
        completedSubtasks: [],
        completedMainWithSubtasks: [],
        unchecked: []
    };

    const timestamp = moment().format(this.settings.dateFormat);
    const icon = this.settings.icon;
    const completedSectionRange = this.getCompletedSectionRange(editor);
    
    const timestampPattern = new RegExp(`${this.escapeRegExp(icon)}\\s*\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}`);
    const linesInBlocksToMove = new Set<number>();

    // --- PRIMERA PASADA: Identificar bloques ---
    for (let i = 0; i < editor.lineCount(); i++) {
        if (completedSectionRange && i >= completedSectionRange.start && i <= completedSectionRange.end) continue;
        
        const originalLine = editor.getLine(i);
        const line = originalLine.trim();
        
        if (!/^- \[[ x]\]\s/i.test(line)) continue;
        if (line.includes('🔔') && /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(line)) continue;

        const isChecked = /^- \[x\]\s/i.test(line);
        const indent = this.getIndentLevel(originalLine);
        
        if (indent === 0 && isChecked) {
            const hasSubtasks = this.hasSubtasks(editor, i);
            if (hasSubtasks) {
                const allCompleted = this.areAllSubtasksCompleted(editor, i);
                if (allCompleted) {
                    const blockEnd = this.findBlockEnd(editor, i);
                    for (let j = i; j <= blockEnd; j++) linesInBlocksToMove.add(j);
                    changes.completedMainWithSubtasks.push({ 
                        line: i, 
                        originalText: line, 
                        originalLine 
                    });
                }
            }
        }
    }

    // --- SEGUNDA PASADA: Procesar cambios ---
    for (let i = 0; i < editor.lineCount(); i++) {
        if (completedSectionRange && i >= completedSectionRange.start && i <= completedSectionRange.end) continue;
        if (linesInBlocksToMove.has(i)) continue;

        const originalLine = editor.getLine(i);
        const line = originalLine.trim();
        
        if (!/^- \[[ x]\]\s/i.test(line)) continue;
        if (line.includes('🔔') && /\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(line)) continue;

        const isChecked = /^- \[x\]\s/i.test(line);
        const indent = this.getIndentLevel(originalLine);
        
        // 🚨 DETECCIÓN DE TIMESTAMP EXISTENTE
        const hasTimestamp = timestampPattern.test(originalLine);
        const iconCount = (originalLine.match(new RegExp(this.escapeRegExp(icon), 'g')) || []).length;
        
        // ============= SUBTAREA MARCADA =============
        if (indent > 0 && isChecked) {
            // ✅ SI YA TIENE TIMESTAMP - NO HACER NADA
            if (hasTimestamp || iconCount > 0) {
                continue;
            }
            
            // 🟢 AÑADIR TIMESTAMP INMEDIATAMENTE
            const newText = `${originalLine} ${icon} ${timestamp}`;
            
            editor.replaceRange(
                newText,
                { line: i, ch: 0 },
                { line: i, ch: originalLine.length }
            );
            
            changes.completedSubtasks.push({
                line: i,
                text: newText,
                originalText: line,
                originalLine
            });
            
            console.log(`   ✅ TIMESTAMP AÑADIDO a línea ${i}: "${newText}"`);
        }
        
        // ============= TAREA INDIVIDUAL =============
        else if (indent === 0 && isChecked && !this.hasSubtasks(editor, i)) {
            if (hasTimestamp) continue;
            
            const indentSpaces = originalLine.match(/^\s*/)?.[0] || '';
            const newText = `${originalLine}\n${indentSpaces}${icon} ${timestamp}`;
            
            changes.completedIndividual.push({
                line: i,
                text: newText,
                originalText: line,
                originalLine,
                lineCount: 2
            });
        }
    }

    return changes;
}

// Método auxiliar necesario
findBlockEnd(editor: Editor, lineIndex: number): number {
    const originalIndent = this.getIndentLevel(editor.getLine(lineIndex));
    let endLineIndex = lineIndex;
    
    while (endLineIndex + 1 < editor.lineCount()) {
        const nextLine = editor.getLine(endLineIndex + 1);
        const nextIndent = this.getIndentLevel(nextLine);
        
        if (nextIndent > originalIndent) {
            endLineIndex++;
        } else {
            break;
        }
    }
    
    return endLineIndex;
}

    countTaskBlockLines(editor: Editor, lineIndex: number): number {
        const originalIndent = this.getIndentLevel(editor.getLine(lineIndex));
        let endLineIndex = lineIndex;

        while (endLineIndex + 1 < editor.lineCount()) {
            const nextLine = editor.getLine(endLineIndex + 1);
            const nextIndent = this.getIndentLevel(nextLine);

            if (nextIndent > originalIndent) {
                endLineIndex++;
            } else {
                break;
            }
        }

        return endLineIndex - lineIndex + 1;
    }

getCompletedSectionRange(editor: Editor): SectionRange | null {
    const sectionTitle = this.settings.sectionTitle;
    const content = editor.getValue();
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i];
        if (!currentLine) continue;
        
        if (currentLine.trim() === sectionTitle.trim()) {
            let startLine = i + 1;

            if (startLine < lines.length) {
                const nextLine = lines[startLine];
                if (nextLine?.trim() === '---') {
                    startLine++;
                }
            }

            let endLine = startLine;
            while (endLine < lines.length) {
                const line = lines[endLine];
                if (!line) break;
                
                const trimmed = line.trim();
                if (trimmed === '' || trimmed.startsWith('#')) {
                    break;
                }
                endLine++;
            }

            return {
                start: startLine,
                end: endLine - 1
            };
        }
    }

    return null;
}

areAllSubtasksCompleted(editor: Editor, lineIndex: number): boolean {
    const currentIndent = this.getIndentLevel(editor.getLine(lineIndex));
    let nextLineIndex = lineIndex + 1;
    let subtaskCount = 0;
    let completedCount = 0;
    
    const icon = this.settings.icon;
    const timestampPattern = new RegExp(`${this.escapeRegExp(icon)}\\s*\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}`);

    while (nextLineIndex < editor.lineCount()) {
        const nextLine = editor.getLine(nextLineIndex);
        const nextIndent = this.getIndentLevel(nextLine);

        // Si encontramos una línea con menor o igual indentación, terminamos el bloque
        if (nextIndent <= currentIndent) {
            break;
        }

        // SOLO procesar líneas que son checkboxes (subtareas)
        if (/^- \[[ x]\]\s/i.test(nextLine.trim())) {
            subtaskCount++;
            
            // 🟢 UNA SUBTAREA ESTÁ COMPLETADA SI:
            const isChecked = /^- \[x\]\s/i.test(nextLine.trim());  // 1. Está marcada con [x]
            const hasTimestamp = timestampPattern.test(nextLine);    // 2. YA tiene timestamp ✅
            
            if (isChecked || hasTimestamp) {
                completedCount++;
            }
        }

        nextLineIndex++;
    }

    // ✅ Solo retornar true si HAY subtareas y TODAS están completadas
    const result = subtaskCount > 0 && completedCount === subtaskCount;
    
    console.log(`   📊 Subtareas: ${completedCount}/${subtaskCount} completadas → ${result ? '✅ MOVER' : '⏸️ ESPERAR'}`);
    
    return result;
}

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        // Cleanup if needed
    }
}

class AutoArchiveSettingTab extends PluginSettingTab {
    plugin: AutoArchiveTaskPlugin;

    constructor(app: App, plugin: AutoArchiveTaskPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Auto Archive Task Settings' });

        containerEl.createEl('h3', { text: 'Behavior' });

        new Setting(containerEl)
            .setName('Move automatically')
            .setDesc('Automatically move completed tasks to the end of the note')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoMove)
                .onChange(async (value) => {
                    this.plugin.settings.autoMove = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-switch to edit mode')
            .setDesc('Switch from preview to edit mode when a checkbox is clicked')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSwitchToEditMode)
                .onChange(async (value) => {
                    this.plugin.settings.autoSwitchToEditMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Return to view mode')
            .setDesc('Automatically switch back to preview mode after processing')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.returnToViewMode)
                .onChange(async (value) => {
                    this.plugin.settings.returnToViewMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Delay (ms)')
            .setDesc('Wait time after checking a task before moving it')
            .addSlider(slider => slider
                .setLimits(100, 1000, 50)
                .setValue(this.plugin.settings.delay)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.delay = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Format' });

        new Setting(containerEl)
            .setName('Completion icon')
            .setDesc('Icon to show when a task is completed')
            .addText(text => text
                .setPlaceholder('✅')
                .setValue(this.plugin.settings.icon)
                .onChange(async (value) => {
                    this.plugin.settings.icon = value || '✅';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Date format')
            .setDesc('Timestamp format (uses moment.js format)')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD HH:mm:ss')
                .setValue(this.plugin.settings.dateFormat)
                .onChange(async (value) => {
                    this.plugin.settings.dateFormat = value || 'YYYY-MM-DD HH:mm:ss';
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Completed Tasks Section' });

        new Setting(containerEl)
            .setName('Create section automatically')
            .setDesc('Create a section for completed tasks if it doesn\'t exist')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.createSection)
                .onChange(async (value) => {
                    this.plugin.settings.createSection = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Section title')
            .setDesc('Title of the section where completed tasks will be grouped')
            .addText(text => text
                .setPlaceholder('## Completed Tasks')
                .setValue(this.plugin.settings.sectionTitle)
                .onChange(async (value) => {
                    this.plugin.settings.sectionTitle = value || '## Completed Tasks';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Add --- separator')
            .setDesc('Add a --- line below the section title')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addSeparator)
                .onChange(async (value) => {
                    this.plugin.settings.addSeparator = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Smart Behavior' });

        containerEl.createEl('div', { 
            text: '🎯 Intelligent task handling:' 
        }).style.fontSize = '0.9em';

        containerEl.createEl('ul', {}, (ul) => {
            ul.createEl('li', { 
                text: 'Parent tasks with subtasks: Timestamp on new line below' 
            });
            ul.createEl('li', { 
                text: 'Individual tasks: Moved to the end with timestamp on same line' 
            });
            ul.createEl('li', { 
                text: 'Subtasks: NOT moved individually, only with their parent task' 
            });
        }).style.fontSize = '0.85em';

        containerEl.createEl('hr');
        containerEl.createEl('p', { 
            text: '💡 Works in preview mode: clicking a checkbox temporarily switches to edit mode for processing.' 
        }).style.fontSize = '0.8em';
        containerEl.createEl('p', { 
            text: '⚙️ Disable "Auto-switch to edit mode" if you prefer to stay in preview.' 
        }).style.fontSize = '0.8em';
    }
}