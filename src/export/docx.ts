import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Packer,
  AlignmentType,
} from 'docx';
import type { TranscriptSegment, FailedChunk, DocxMetadata } from '../types.js';

export interface DocxExportOptions {
  metadata: DocxMetadata;
  transcript: TranscriptSegment[];
  failedChunks?: FailedChunk[];
  outputDir: string;
  filename: string;
}

// 共用框線樣式
const BORDER_STYLE = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: '999999',
};

const TABLE_BORDERS = {
  top: BORDER_STYLE,
  bottom: BORDER_STYLE,
  left: BORDER_STYLE,
  right: BORDER_STYLE,
};

/**
 * DocxExporter：使用 docx 套件產生 Word 文件。
 *
 * 特色：
 * - Heading 1/2 層級標題
 * - 表格含框線
 * - 時間戳 [HH:MM:SS] 使用 Consolas 灰色字體
 * - 失敗時拋出可識別錯誤
 */
export class DocxExporter {
  /**
   * 匯出 DOCX 檔案，回傳檔案完整路徑。
   */
  async export(options: DocxExportOptions): Promise<string> {
    try {
      const doc = this.createDocument(options);
      const buffer = await Packer.toBuffer(doc);
      const filePath = path.join(options.outputDir, options.filename);

      // 確保輸出目錄存在
      if (!fs.existsSync(options.outputDir)) {
        await fs.promises.mkdir(options.outputDir, { recursive: true });
      }

      await fs.promises.writeFile(filePath, buffer);
      return filePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DocxGenerationError(`DOCX 匯出失敗: ${message}`);
    }
  }

  /**
   * 建立 Document 物件
   */
  private createDocument(options: DocxExportOptions): Document {
    const { metadata, transcript, failedChunks } = options;

    const children: (Paragraph | Table)[] = [];

    // 標題（Heading 1）
    children.push(
      new Paragraph({
        text: metadata.meetingName,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 },
      })
    );

    // 中繼資料表格
    children.push(this.createMetadataTable(metadata));

    // 空行
    children.push(new Paragraph({ text: '', spacing: { after: 200 } }));

    // 逐字稿標題（Heading 2）
    children.push(
      new Paragraph({
        text: '逐字稿',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 },
      })
    );

    // 逐字稿內容
    if (transcript.length === 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: '無逐字稿內容', italics: true, color: '888888' }),
          ],
        })
      );
    } else {
      for (const segment of transcript) {
        children.push(this.createTranscriptParagraph(segment));
      }
    }

    // 失敗區段
    if (failedChunks && failedChunks.length > 0) {
      children.push(
        new Paragraph({
          text: '未能轉譯的區段',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 200 },
        })
      );

      for (const chunk of failedChunks) {
        const startTs = this.formatTimestamp(chunk.start_time);
        const endTs = this.formatTimestamp(chunk.end_time);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[${startTs} - ${endTs}] `,
                font: 'Consolas',
                color: '888888',
              }),
              new TextRun({ text: chunk.error }),
            ],
          })
        );
      }
    }

    return new Document({
      sections: [{ children }],
    });
  }

  /**
   * 建立中繼資料表格
   */
  private createMetadataTable(metadata: DocxMetadata): Table {
    const rows = [
      ['日期', metadata.date],
      ['時長', metadata.duration],
      ['語言', metadata.language],
      ['參與者', metadata.participants.join(', ')],
    ];

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        ([label, value]) =>
          new TableRow({
            children: [
              new TableCell({
                borders: TABLE_BORDERS,
                width: { size: 20, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: label!, bold: true })],
                  }),
                ],
              }),
              new TableCell({
                borders: TABLE_BORDERS,
                width: { size: 80, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: value! })],
                  }),
                ],
              }),
            ],
          })
      ),
    });
  }

  /**
   * 建立逐字稿段落：時間戳用 Consolas 灰色
   */
  private createTranscriptParagraph(segment: TranscriptSegment): Paragraph {
    const timestamp = this.formatTimestamp(segment.start);
    return new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({
          text: `[${timestamp}] `,
          font: 'Consolas',
          color: '888888',
          size: 20,
        }),
        new TextRun({
          text: segment.text,
          size: 22,
        }),
      ],
    });
  }

  /**
   * 格式化時間戳 HH:MM:SS
   */
  private formatTimestamp(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map((v) => v.toString().padStart(2, '0')).join(':');
  }
}

/**
 * DOCX 產生專用錯誤類別
 */
export class DocxGenerationError extends Error {
  public readonly code = 'DOCX_GENERATION_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'DocxGenerationError';
  }
}
