import * as fs from 'fs';
import * as path from 'path';
import { createChildLogger } from '../utils/logger';
import { StateDelta } from '../core/types';

const log = createChildLogger('WriteAheadLog');

export interface WALEntry {
  sequence: number;
  timestamp: number;
  type: 'delta' | 'snapshot' | 'checkpoint';
  data: string;
}

export class WriteAheadLog {
  private readonly walDir: string;
  private currentFile: string;
  private sequence: number = 0;
  private writeStream: fs.WriteStream | null = null;
  private readonly maxFileSize: number;
  private currentFileSize: number = 0;
  private entriesWritten: number = 0;

  constructor(walDir: string, maxFileSize: number = 10 * 1024 * 1024) {
    this.walDir = walDir;
    this.maxFileSize = maxFileSize;
    this.currentFile = '';

    if (!fs.existsSync(walDir)) {
      fs.mkdirSync(walDir, { recursive: true });
    }
  }

  start(): void {
    this.currentFile = this.generateFileName();
    this.openWriteStream();
    log.info('WAL started', { walDir: this.walDir, file: this.currentFile });
  }

  stop(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
    log.info('WAL stopped', { entriesWritten: this.entriesWritten });
  }

  append(type: WALEntry['type'], data: unknown): number {
    this.sequence++;
    const entry: WALEntry = {
      sequence: this.sequence,
      timestamp: Date.now(),
      type,
      data: JSON.stringify(data),
    };

    const line = JSON.stringify(entry) + '\n';
    const lineBytes = Buffer.byteLength(line, 'utf-8');

    if (this.currentFileSize + lineBytes > this.maxFileSize) {
      this.rotateFile();
    }

    if (this.writeStream) {
      this.writeStream.write(line);
      this.currentFileSize += lineBytes;
      this.entriesWritten++;
    }

    return this.sequence;
  }

  appendDelta(delta: StateDelta): number {
    return this.append('delta', delta);
  }

  appendCheckpoint(version: number): number {
    return this.append('checkpoint', { version, timestamp: Date.now() });
  }

  replay(fromSequence: number = 0): WALEntry[] {
    const entries: WALEntry[] = [];
    const files = this.getWALFiles();

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.walDir, file), 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as WALEntry;
            if (entry.sequence > fromSequence) {
              entries.push(entry);
            }
          } catch {
            log.warn('Corrupt WAL entry', { file, line: line.substring(0, 50) });
          }
        }
      } catch (err) {
        log.error('Failed to read WAL file', { file, error: (err as Error).message });
      }
    }

    return entries.sort((a, b) => a.sequence - b.sequence);
  }

  truncate(beforeSequence: number): void {
    const files = this.getWALFiles();
    for (const file of files) {
      if (file === path.basename(this.currentFile)) continue;

      try {
        const content = fs.readFileSync(path.join(this.walDir, file), 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        const lastLine = lines[lines.length - 1];

        if (lastLine) {
          const entry = JSON.parse(lastLine) as WALEntry;
          if (entry.sequence < beforeSequence) {
            fs.unlinkSync(path.join(this.walDir, file));
            log.debug('WAL file truncated', { file });
          }
        }
      } catch {
        // skip corrupt files
      }
    }
  }

  private rotateFile(): void {
    if (this.writeStream) {
      this.writeStream.end();
    }
    this.currentFile = this.generateFileName();
    this.openWriteStream();
    this.currentFileSize = 0;
    log.debug('WAL file rotated', { file: this.currentFile });
  }

  private openWriteStream(): void {
    const filePath = path.join(this.walDir, this.currentFile);
    this.writeStream = fs.createWriteStream(filePath, { flags: 'a' });
    this.writeStream.on('error', (err) => {
      log.error('WAL write error', { error: err.message });
    });
  }

  private generateFileName(): string {
    return `wal-${Date.now()}-${this.sequence}.log`;
  }

  private getWALFiles(): string[] {
    try {
      return fs.readdirSync(this.walDir)
        .filter(f => f.startsWith('wal-') && f.endsWith('.log'))
        .sort();
    } catch {
      return [];
    }
  }

  getStats(): { entriesWritten: number; currentSequence: number; currentFileSize: number } {
    return {
      entriesWritten: this.entriesWritten,
      currentSequence: this.sequence,
      currentFileSize: this.currentFileSize,
    };
  }
}
