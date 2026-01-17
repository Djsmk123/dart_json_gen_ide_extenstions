import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

type ExtensionSettings = {
    autoRefresh: boolean;
    showNotifications: boolean;
    verboseOutput: boolean;
};

type TargetResolution = {
    targetPath: string;
    isFile: boolean;
};

let outputChannel: vscode.OutputChannel;

function getExtensionSettings(): ExtensionSettings {
    const config = vscode.workspace.getConfiguration('dartJsonGen');
    return {
        autoRefresh: config.get<boolean>('autoRefresh', true),
        showNotifications: config.get<boolean>('showNotifications', true),
        verboseOutput: config.get<boolean>('verboseOutput', false)
    };
}

/**
 * Read dart_json_gen configuration file to get custom extension
 * Searches upwards from the starting directory
 */
function readConfigExtension(startPath: string): string {
    let currentDir = fs.statSync(startPath).isFile() ? path.dirname(startPath) : startPath;
    
    // Search upwards
    while (true) {
        const configPaths = [
            path.join(currentDir, 'dart_json_gen.yaml'),
            path.join(currentDir, 'dart_json_gen.yml')
        ];

        for (const configPath of configPaths) {
            if (fs.existsSync(configPath)) {
                try {
                    const content = fs.readFileSync(configPath, 'utf8');
                    // Simple YAML parsing for generated_extension
                    const match = content.match(/generated_extension:\s*["']?([^"'\n]+)["']?/);
                    if (match && match[1]) {
                        return match[1].trim();
                    }
                } catch (error) {
                    // If config file can't be read, continue searching
                }
            }
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break; // Reached root
        }
        currentDir = parentDir;
    }

    return '.gen.dart'; // Default extension
}

function resolveTargetPath(
    uri?: vscode.Uri,
    type: 'file' | 'folder' = 'folder'
): TargetResolution | null {
    let targetPath: string;

    if (uri) {
        targetPath = uri.fsPath;
    } else {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            targetPath = type === 'file'
                ? activeEditor.document.fileName
                : path.dirname(activeEditor.document.fileName);
        } else {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder found');
                return null;
            }
            targetPath = workspaceFolders[0].uri.fsPath;
        }
    }

    if (!fs.existsSync(targetPath)) {
        vscode.window.showErrorMessage(`Path does not exist: ${targetPath}`);
        return null;
    }

    const stats = fs.statSync(targetPath);
    const isFile = stats.isFile();

    if (isFile && !targetPath.endsWith('.dart')) {
        vscode.window.showWarningMessage('Please select a .dart file');
        return null;
    }

    return { targetPath, isFile };
}

function getInputInfo(
    targetPath: string,
    isFile: boolean,
    type: 'file' | 'folder'
): { inputPath: string; displayName: string } {
    if (type === 'file' && isFile) {
        return {
            inputPath: targetPath,
            displayName: path.basename(targetPath)
        };
    }

    const inputPath = isFile ? path.dirname(targetPath) : targetPath;
    return {
        inputPath,
        displayName: path.basename(inputPath)
    };
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Dart JSON Generator extension is now active');

    // Create output channel
    outputChannel = vscode.window.createOutputChannel('Dart JSON Generator');

    // Register command for file generation
    const generateFileCommand = vscode.commands.registerCommand(
        'dartJsonGen.generateFile',
        async (uri?: vscode.Uri) => {
            await generateCode(uri, 'file');
        }
    );

    // Register command for folder generation
    const generateFolderCommand = vscode.commands.registerCommand(
        'dartJsonGen.generateFolder',
        async (uri?: vscode.Uri) => {
            await generateCode(uri, 'folder');
        }
    );

    // Register command for cleaning file
    const cleanFileCommand = vscode.commands.registerCommand(
        'dartJsonGen.cleanFile',
        async (uri?: vscode.Uri) => {
            await cleanGeneratedFiles(uri, 'file');
        }
    );

    // Register command for cleaning folder
    const cleanFolderCommand = vscode.commands.registerCommand(
        'dartJsonGen.cleanFolder',
        async (uri?: vscode.Uri) => {
            await cleanGeneratedFiles(uri, 'folder');
        }
    );

    context.subscriptions.push(
        generateFileCommand,
        generateFolderCommand,
        cleanFileCommand,
        cleanFolderCommand,
        outputChannel
    );
}

async function generateCode(uri?: vscode.Uri, type: 'file' | 'folder' = 'folder') {
    try {
        const { autoRefresh, showNotifications, verboseOutput } = getExtensionSettings();

        const targetResolution = resolveTargetPath(uri, type);
        if (!targetResolution) {
            return;
        }
        const { targetPath, isFile } = targetResolution;

        const { inputPath, displayName } = getInputInfo(targetPath, isFile, type);

        if (verboseOutput) {
            outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Starting generation...`);
            outputChannel.appendLine(`Target: ${inputPath}`);
            outputChannel.appendLine(`Type: ${type}`);
        }

        // Show progress notification
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Generating JSON code for ${displayName}`,
                cancellable: false
            },
            async (progress) => {
                progress.report({ increment: 0, message: 'Checking dart_json_gen...' });

                try {
                    // Check if dart_json_gen is available
                    let dartJsonGenCommand = 'dart_json_gen';
                    
                    // Try to find dart_json_gen in PATH or pub cache
                    try {
                        // Check if command exists
                        if (process.platform === 'win32') {
                            await execAsync('where dart_json_gen');
                        } else {
                            await execAsync('which dart_json_gen');
                        }
                        
                        if (verboseOutput) {
                            outputChannel.appendLine('✓ Found dart_json_gen in PATH');
                        }
                    } catch {
                        // Try dart pub global run
                        try {
                            await execAsync('dart pub global run dart_json_annotations:dart_json_gen --help');
                            dartJsonGenCommand = 'dart pub global run dart_json_annotations:dart_json_gen';
                            
                            if (verboseOutput) {
                                outputChannel.appendLine('✓ Using dart pub global run');
                            }
                        } catch {
                            const errorMsg = 'dart_json_gen not found. Please install it with: dart pub global activate dart_json_annotations';
                            vscode.window.showErrorMessage(errorMsg, 'Install Now').then(selection => {
                                if (selection === 'Install Now') {
                                    const terminal = vscode.window.createTerminal('Dart JSON Generator');
                                    terminal.show();
                                    terminal.sendText('dart pub global activate dart_json_annotations');
                                }
                            });
                            return;
                        }
                    }

                    progress.report({ increment: 30, message: 'Running generator...' });

                    // Execute the generator
                    const command = `${dartJsonGenCommand} -i "${inputPath}"`;
                    
                    if (verboseOutput) {
                        outputChannel.appendLine(`Command: ${command}`);
                    }

                    const { stdout, stderr } = await execAsync(command, {
                        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
                        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
                    });

                    progress.report({ increment: 70, message: 'Processing output...' });

                    // Show output
                    if (stdout) {
                        if (verboseOutput) {
                            outputChannel.appendLine('Output:');
                            outputChannel.appendLine(stdout);
                        }
                    }
                    if (stderr) {
                        outputChannel.appendLine('Warnings:');
                        outputChannel.appendLine(stderr);
                    }

                    progress.report({ increment: 100, message: 'Complete!' });

                    // Show success message
                    if (showNotifications) {
                        const message = type === 'file' 
                            ? `Generated code for: ${displayName}`
                            : `Generated code for folder: ${displayName}`;
                        
                        vscode.window.showInformationMessage(`✅ ${message}`);
                    }

                    if (verboseOutput) {
                        outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Generation complete!`);
                        outputChannel.appendLine('---');
                    }

                    // Optionally refresh the explorer
                    if (autoRefresh) {
                        vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
                    }

                } catch (error: any) {
                    const errorMessage = error.message || 'Unknown error occurred';
                    
                    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ERROR:`);
                    outputChannel.appendLine(errorMessage);
                    
                    if (error.stdout) {
                        outputChannel.appendLine('\\nOutput:');
                        outputChannel.appendLine(error.stdout);
                    }
                    if (error.stderr) {
                        outputChannel.appendLine('\\nError Output:');
                        outputChannel.appendLine(error.stderr);
                    }
                    outputChannel.appendLine('---');
                    
                    if (showNotifications) {
                        vscode.window.showErrorMessage(
                            `Failed to generate code: ${errorMessage}`,
                            'Show Output'
                        ).then(selection => {
                            if (selection === 'Show Output') {
                                outputChannel.show();
                            }
                        });
                    }
                }
            }
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
        outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] FATAL ERROR: ${error.message}`);
    }
}

async function cleanGeneratedFiles(uri?: vscode.Uri, type: 'file' | 'folder' = 'folder') {
    try {
        const { autoRefresh, showNotifications, verboseOutput } = getExtensionSettings();

        const targetResolution = resolveTargetPath(uri, type);
        if (!targetResolution) {
            return;
        }
        const { targetPath, isFile } = targetResolution;
        const { inputPath, displayName } = getInputInfo(targetPath, isFile, type);

        // Determine input path and find generated files
        let filesToDelete: string[] = [];
        
        // Get extension from config
        const genExtension = readConfigExtension(targetPath);
        
        if (verboseOutput) {
            outputChannel.appendLine(`Using extension: ${genExtension}`);
        }
        
        if (type === 'file' && isFile) {
            // For a single file, find its corresponding generated file
            const genFilePath = targetPath.replace(/\.dart$/, genExtension);
            if (fs.existsSync(genFilePath)) {
                filesToDelete.push(genFilePath);
            }
        } else {
            // For a folder, find all generated files recursively
            filesToDelete = findGenDartFiles(inputPath, genExtension);
        }

        if (filesToDelete.length === 0) {
            vscode.window.showInformationMessage('No generated files found to clean');
            return;
        }

        // Ask for confirmation
        const fileList = filesToDelete.map(f => path.basename(f)).join('\\n  ');
        const confirmMessage = type === 'file'
            ? `Delete ${path.basename(filesToDelete[0])}?`
            : `Delete ${filesToDelete.length} generated file(s) in ${displayName}?\\n\\nFiles:\\n  ${fileList.substring(0, 200)}${filesToDelete.length > 5 ? '\\n  ...' : ''}`;
        
        const confirmation = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (confirmation !== 'Delete') {
            return;
        }

        if (verboseOutput) {
            outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Cleaning generated files...`);
            outputChannel.appendLine(`Target: ${targetPath}`);
            outputChannel.appendLine(`Files to delete: ${filesToDelete.length}`);
        }

        // Delete files with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Cleaning generated files in ${displayName}`,
                cancellable: false
            },
            async (progress) => {
                let deletedCount = 0;
                const total = filesToDelete.length;

                for (const file of filesToDelete) {
                    try {
                        fs.unlinkSync(file);
                        deletedCount++;
                        
                        if (verboseOutput) {
                            outputChannel.appendLine(`Deleted: ${path.basename(file)}`);
                        }
                        
                        progress.report({
                            increment: (100 / total),
                            message: `${deletedCount}/${total} files deleted`
                        });
                    } catch (error: any) {
                        outputChannel.appendLine(`Failed to delete ${file}: ${error.message}`);
                    }
                }

                if (showNotifications) {
                    const message = `Deleted ${deletedCount} generated file(s)`;
                    vscode.window.showInformationMessage(`✅ ${message}`);
                }

                if (verboseOutput) {
                    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Cleanup complete!`);
                    outputChannel.appendLine('---');
                }

                // Refresh the explorer
                if (autoRefresh) {
                    vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
                }
            }
        );
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error: ${error.message}`);
        outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] CLEANUP ERROR: ${error.message}`);
    }
}

function findGenDartFiles(directory: string, extension: string = '.gen.dart'): string[] {
    const genFiles: string[] = [];
    
    function searchDirectory(dir: string) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    // Skip common directories that shouldn't contain generated files
                    if (!['node_modules', '.git', '.dart_tool', 'build'].includes(entry.name)) {
                        searchDirectory(fullPath);
                    }
                } else if (entry.isFile() && entry.name.endsWith(extension)) {
                    genFiles.push(fullPath);
                }
            }
        } catch (error) {
            // Silently skip directories we can't read
        }
    }
    
    searchDirectory(directory);
    return genFiles;
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.dispose();
    }
}
