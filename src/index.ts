#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface FileVersionArgs {
  repoPath: string;
  file: string;
  outputPath: string;
}

interface FileDiffArgs {
  repoPath: string;
  file: string;
  versions: {
    from: string;
    to: string;
  };
  outputPath: string;
}

interface FileContextArgs {
  repoPath: string;
  file: string;
  commit: string;
  outputPath: string;
}

interface FileSemanticArgs {
  repoPath: string;
  file: string;
  outputPath: string;
}

interface SemanticChange {
  type: 'addition' | 'deletion' | 'modification';
  content: string;
  context?: string;
  impact: 'high' | 'medium' | 'low';
}

interface ChangePattern {
  pattern: string;
  frequency: number;
  significance: 'high' | 'medium' | 'low';
  context: string;
}

class GitFileForensicsServer {
  private server: Server;

  private isFileVersionArgs(args: unknown): args is FileVersionArgs {
    return (
      typeof args === 'object' &&
      args !== null &&
      'repoPath' in args &&
      'file' in args &&
      'outputPath' in args &&
      typeof (args as FileVersionArgs).repoPath === 'string' &&
      typeof (args as FileVersionArgs).file === 'string' &&
      typeof (args as FileVersionArgs).outputPath === 'string'
    );
  }

  private isFileDiffArgs(args: unknown): args is FileDiffArgs {
    return (
      typeof args === 'object' &&
      args !== null &&
      'repoPath' in args &&
      'file' in args &&
      'versions' in args &&
      'outputPath' in args &&
      typeof (args as FileDiffArgs).repoPath === 'string' &&
      typeof (args as FileDiffArgs).file === 'string' &&
      typeof (args as FileDiffArgs).outputPath === 'string' &&
      typeof (args as FileDiffArgs).versions === 'object' &&
      (args as FileDiffArgs).versions !== null &&
      'from' in (args as FileDiffArgs).versions &&
      'to' in (args as FileDiffArgs).versions &&
      typeof (args as FileDiffArgs).versions.from === 'string' &&
      typeof (args as FileDiffArgs).versions.to === 'string'
    );
  }

  private isFileContextArgs(args: unknown): args is FileContextArgs {
    return (
      typeof args === 'object' &&
      args !== null &&
      'repoPath' in args &&
      'file' in args &&
      'commit' in args &&
      'outputPath' in args &&
      typeof (args as FileContextArgs).repoPath === 'string' &&
      typeof (args as FileContextArgs).file === 'string' &&
      typeof (args as FileContextArgs).commit === 'string' &&
      typeof (args as FileContextArgs).outputPath === 'string'
    );
  }

  private isFileSemanticArgs(args: unknown): args is FileSemanticArgs {
    return (
      typeof args === 'object' &&
      args !== null &&
      'repoPath' in args &&
      'file' in args &&
      'outputPath' in args &&
      typeof (args as FileSemanticArgs).repoPath === 'string' &&
      typeof (args as FileSemanticArgs).file === 'string' &&
      typeof (args as FileSemanticArgs).outputPath === 'string'
    );
  }

  constructor() {
    this.server = new Server(
      {
        name: 'git-file-forensics-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    
    this.server.onerror = (error: Error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'track_file_versions',
          description: 'Track complete version history of a specific file, including renames and moves',
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to git repository',
              },
              file: {
                type: 'string',
                description: 'File to analyze',
              },
              outputPath: {
                type: 'string',
                description: 'Path to write analysis output',
              },
            },
            required: ['repoPath', 'file', 'outputPath'],
          },
        },
        {
          name: 'analyze_file_diff',
          description: 'Analyze specific changes between any two versions of a file',
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to git repository',
              },
              file: {
                type: 'string',
                description: 'File to analyze',
              },
              versions: {
                type: 'object',
                properties: {
                  from: { type: 'string' },
                  to: { type: 'string' },
                },
                required: ['from', 'to'],
              },
              outputPath: {
                type: 'string',
                description: 'Path to write analysis output',
              },
            },
            required: ['repoPath', 'file', 'versions', 'outputPath'],
          },
        },
        {
          name: 'analyze_file_context',
          description: 'Analyze broader context of file changes in a specific commit',
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to git repository',
              },
              file: {
                type: 'string',
                description: 'File to analyze',
              },
              commit: {
                type: 'string',
                description: 'Commit hash to analyze',
              },
              outputPath: {
                type: 'string',
                description: 'Path to write analysis output',
              },
            },
            required: ['repoPath', 'file', 'commit', 'outputPath'],
          },
        },
        {
          name: 'analyze_file_semantics',
          description: 'Analyze semantic changes and patterns in file history',
          inputSchema: {
            type: 'object',
            properties: {
              repoPath: {
                type: 'string',
                description: 'Path to git repository',
              },
              file: {
                type: 'string',
                description: 'File to analyze',
              },
              outputPath: {
                type: 'string',
                description: 'Path to write analysis output',
              },
            },
            required: ['repoPath', 'file', 'outputPath'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args = request.params.arguments;
      try {
        switch (request.params.name) {
          case 'track_file_versions': {
            const args = request.params.arguments as unknown;
            if (!this.isFileVersionArgs(args)) {
              throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters');
            }
            return await this.handleFileVersions(args);
          }
          case 'analyze_file_diff': {
            const args = request.params.arguments as unknown;
            if (!this.isFileDiffArgs(args)) {
              throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters');
            }
            return await this.handleFileDiff(args);
          }
          case 'analyze_file_context': {
            const args = request.params.arguments as unknown;
            if (!this.isFileContextArgs(args)) {
              throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters');
            }
            return await this.handleFileContext(args);
          }
          case 'analyze_file_semantics': {
            const args = request.params.arguments as unknown;
            if (!this.isFileSemanticArgs(args)) {
              throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters');
            }
            return await this.handleFileSemantics(args);
          }
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Git file forensics error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private async handleFileVersions(args: FileVersionArgs) {
    const history = this.getCompleteFileHistory(args.repoPath, args.file);
    const renames = this.getFileRenames(args.repoPath, args.file);
    
    const analysis = {
      history,
      renames,
      summary: this.generateVersionSummary(history),
    };

    writeFileSync(args.outputPath, JSON.stringify(analysis, null, 2));

    return {
      content: [
        {
          type: 'text',
          text: `File version analysis written to ${args.outputPath}`,
        },
      ],
    };
  }

  private async handleFileDiff(args: FileDiffArgs) {
    const diff = this.getFileDiff(args.repoPath, args.file, args.versions);
    const movedBlocks = this.findMovedBlocks(diff);
    
    const analysis = {
      diff,
      movedBlocks,
      summary: this.generateDiffSummary(diff),
    };

    writeFileSync(args.outputPath, JSON.stringify(analysis, null, 2));

    return {
      content: [
        {
          type: 'text',
          text: `File diff analysis written to ${args.outputPath}`,
        },
      ],
    };
  }

  private async handleFileContext(args: FileContextArgs) {
    const relatedFiles = this.getRelatedFiles(args.repoPath, args.file, args.commit);
    const commitInfo = this.getCommitContext(args.repoPath, args.commit);
    
    const analysis = {
      relatedFiles,
      commitInfo,
      summary: this.generateContextSummary(relatedFiles, commitInfo),
    };

    writeFileSync(args.outputPath, JSON.stringify(analysis, null, 2));

    return {
      content: [
        {
          type: 'text',
          text: `File context analysis written to ${args.outputPath}`,
        },
      ],
    };
  }

  private async handleFileSemantics(args: FileSemanticArgs) {
    const changes = this.getSemanticChanges(args.repoPath, args.file);
    const patterns = this.analyzeChangePatterns(changes);
    
    const analysis = {
      changes,
      patterns,
      summary: this.generateSemanticSummary(changes, patterns),
    };

    writeFileSync(args.outputPath, JSON.stringify(analysis, null, 2));

    return {
      content: [
        {
          type: 'text',
          text: `File semantic analysis written to ${args.outputPath}`,
        },
      ],
    };
  }

  private getCompleteFileHistory(repoPath: string, file: string) {
    const output = execSync(
      `cd "${repoPath}" && git log --follow --format="%H|%aI|%an|%s" -- "${file}"`,
      { encoding: 'utf8' }
    );

    return output.trim().split('\n').filter(Boolean).map(line => {
      const [hash, date, author, message] = line.split('|');
      return { hash, date, author, message };
    });
  }

  private getFileRenames(repoPath: string, file: string) {
    const output = execSync(
      `cd "${repoPath}" && git log --follow --name-status --format="%H" -- "${file}"`,
      { encoding: 'utf8' }
    );

    const renames: Array<{ commit: string; oldPath: string; newPath: string }> = [];
    let currentCommit = '';

    output.trim().split('\n').forEach(line => {
      if (line.match(/^[0-9a-f]{40}$/)) {
        currentCommit = line;
      } else if (line.startsWith('R')) {
        const [_, oldPath, newPath] = line.split(/\t/);
        renames.push({ commit: currentCommit, oldPath, newPath });
      }
    });

    return renames;
  }

  private getFileDiff(
    repoPath: string,
    file: string,
    versions: { from: string; to: string }
  ) {
    return execSync(
      `cd "${repoPath}" && git diff ${versions.from} ${versions.to} -- "${file}"`,
      { encoding: 'utf8' }
    );
  }

  private findMovedBlocks(diff: string) {
    // Implement sophisticated code block movement detection
    return [];
  }

  private getRelatedFiles(repoPath: string, file: string, commit: string) {
    const output = execSync(
      `cd "${repoPath}" && git show --name-only --format="" ${commit}`,
      { encoding: 'utf8' }
    );

    return output.trim().split('\n').filter(f => f !== file);
  }

  private getCommitContext(repoPath: string, commit: string) {
    const output = execSync(
      `cd "${repoPath}" && git show --format="%H|%aI|%an|%s|%b" ${commit}`,
      { encoding: 'utf8' }
    );

    const [hash, date, author, subject, body] = output.split('|');
    return { hash, date, author, subject, body };
  }

  private getSemanticChanges(repoPath: string, file: string) {
    const output = execSync(
      `cd "${repoPath}" && git log --patch --format="%H|%aI|%s" -- "${file}"`,
      { encoding: 'utf8' }
    );

    // Implement semantic change analysis
    return [];
  }

  private analyzeChangePatterns(changes: SemanticChange[]): ChangePattern[] {
    // Implement pattern analysis
    return [];
  }

  private generateVersionSummary(history: Array<{ date: string; message: string }>) {
    return {
      totalVersions: history.length,
      firstChange: history[history.length - 1],
      lastChange: history[0],
      changeFrequency: this.calculateChangeFrequency(history),
    };
  }

  private generateDiffSummary(diff: string) {
    const lines = diff.split('\n');
    const additions = lines.filter(l => l.startsWith('+')).length;
    const deletions = lines.filter(l => l.startsWith('-')).length;

    return {
      additions,
      deletions,
      changeSize: additions + deletions,
      impactLevel: this.assessImpactLevel(additions + deletions),
    };
  }

  private generateContextSummary(
    relatedFiles: string[],
    commitInfo: { subject: string }
  ) {
    return {
      relatedFileCount: relatedFiles.length,
      changeType: this.categorizeChange(commitInfo.subject),
      impactScope: this.assessImpactScope(relatedFiles),
    };
  }

  private generateSemanticSummary(changes: SemanticChange[], patterns: ChangePattern[]) {
    return {
      dominantPatterns: this.identifyDominantPatterns(patterns),
      changeTypes: this.categorizeChanges(changes),
      stability: this.assessFileStability(changes),
    };
  }

  private calculateChangeFrequency(
    history: Array<{ date: string }>
  ): 'high' | 'medium' | 'low' {
    if (history.length < 2) return 'low';

    const dates = history.map(h => new Date(h.date));
    const totalDays = (dates[0].getTime() - dates[dates.length - 1].getTime()) / (1000 * 60 * 60 * 24);
    const changesPerDay = history.length / totalDays;

    if (changesPerDay > 0.5) return 'high';
    if (changesPerDay > 0.1) return 'medium';
    return 'low';
  }

  private assessImpactLevel(changeSize: number): 'high' | 'medium' | 'low' {
    if (changeSize > 100) return 'high';
    if (changeSize > 30) return 'medium';
    return 'low';
  }

  private categorizeChange(message: string): string {
    if (message.match(/^feat|^add/i)) return 'feature';
    if (message.match(/^fix|^bug/i)) return 'bugfix';
    if (message.match(/^refactor/i)) return 'refactor';
    if (message.match(/^docs/i)) return 'documentation';
    return 'other';
  }

  private assessImpactScope(relatedFiles: string[]): 'high' | 'medium' | 'low' {
    if (relatedFiles.length > 5) return 'high';
    if (relatedFiles.length > 2) return 'medium';
    return 'low';
  }

  private identifyDominantPatterns(patterns: ChangePattern[]): Array<{ pattern: string; significance: string }> {
    // Implement pattern identification
    return [];
  }

  private categorizeChanges(changes: SemanticChange[]): Record<string, number> {
    // Implement change categorization
    return {};
  }

  private assessFileStability(changes: SemanticChange[]): 'stable' | 'evolving' | 'volatile' {
    // Implement stability assessment
    return 'stable';
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Git File Forensics MCP server running on stdio');
  }
}

const server = new GitFileForensicsServer();
server.run().catch(console.error);