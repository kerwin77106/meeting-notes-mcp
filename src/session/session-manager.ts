import type {
  Session,
  SessionStatus,
  SupportedLanguage,
  ChunkRecord,
  TranscriptSegment,
  TranscriptionResult,
} from '../types.js';

/**
 * SessionManager：管理所有錄音 session 的生命週期。
 * - 以 Map<string, Session> 儲存所有 session
 * - 提供建立、查詢、更新、合併逐字稿等功能
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  /**
   * 產生 session ID：mtg-YYYYMMDDHHmmss-xxxx
   */
  private generateSessionId(): string {
    const now = new Date();
    const ts = now.getFullYear().toString()
      + (now.getMonth() + 1).toString().padStart(2, '0')
      + now.getDate().toString().padStart(2, '0')
      + now.getHours().toString().padStart(2, '0')
      + now.getMinutes().toString().padStart(2, '0')
      + now.getSeconds().toString().padStart(2, '0');
    const hex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    return `mtg-${ts}-${hex}`;
  }

  /**
   * 建立新 session
   */
  createSession(meetingName: string, participants: string[], language: SupportedLanguage): Session {
    const sessionId = this.generateSessionId();
    const session: Session = {
      sessionId,
      meetingName,
      participants,
      language,
      status: 'RECORDING',
      startedAt: new Date(),
      transcript: [],
      chunks: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * 取得指定 session
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 取得目前正在錄音中的 session（狀態為 RECORDING）
   */
  getActiveSession(): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.status === 'RECORDING') {
        return session;
      }
    }
    return undefined;
  }

  /**
   * 更新 session 狀態
   */
  updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = status;
    if (status === 'COMPLETED' || status === 'ERROR') {
      session.completedAt = new Date();
    }
  }

  /**
   * 新增 chunk 記錄
   */
  addChunk(sessionId: string, chunk: ChunkRecord): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.chunks.push(chunk);
  }

  /**
   * 更新 chunk 的轉譯結果
   */
  updateChunkResult(sessionId: string, chunkIndex: number, result: TranscriptionResult): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const chunk = session.chunks.find((c) => c.index === chunkIndex);
    if (!chunk) return;
    chunk.status = 'completed';
    chunk.result = result;
  }

  /**
   * 標記 chunk 為失敗
   */
  markChunkFailed(sessionId: string, chunkIndex: number, error: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const chunk = session.chunks.find((c) => c.index === chunkIndex);
    if (!chunk) return;
    chunk.status = 'failed';
    chunk.error = error;
  }

  /**
   * 取得合併後的逐字稿。
   * 合併所有已完成 chunk 的 segments，按時間排序，並去除重疊區段的重複文字。
   */
  getTranscript(sessionId: string): TranscriptSegment[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    // 收集所有已完成 chunk 的 segments
    const allSegments: TranscriptSegment[] = [];
    const completedChunks = session.chunks
      .filter((c) => c.status === 'completed' && c.result)
      .sort((a, b) => a.index - b.index);

    for (const chunk of completedChunks) {
      if (chunk.result) {
        allSegments.push(...chunk.result.segments);
      }
    }

    // 按 start 時間排序
    allSegments.sort((a, b) => a.start - b.start);

    // 去重：移除重疊時間區段中的重複句子
    const deduped = this.deduplicateSegments(allSegments);

    // 更新 session 的 transcript
    session.transcript = deduped;
    return deduped;
  }

  /**
   * 去重演算法：
   * 比較相鄰 segment，若時間重疊且文字相同（以句子為單位），則移除後者。
   */
  private deduplicateSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
    if (segments.length === 0) return [];

    const result: TranscriptSegment[] = [segments[0]!];

    for (let i = 1; i < segments.length; i++) {
      const current = segments[i]!;
      const previous = result[result.length - 1]!;

      // 如果時間不重疊，直接加入
      if (current.start >= previous.end) {
        result.push(current);
        continue;
      }

      // 時間重疊：以句子為單位比較文字
      const prevSentences = this.splitSentences(previous.text);
      const currSentences = this.splitSentences(current.text);

      // 找出 current 中不在 previous 的句子
      const newSentences = currSentences.filter(
        (sentence) => !prevSentences.some((ps) => this.isSimilar(ps, sentence))
      );

      if (newSentences.length > 0) {
        result.push({
          start: current.start,
          end: current.end,
          text: newSentences.join(' '),
        });
      }
    }

    return result;
  }

  /**
   * 將文字拆分為句子
   */
  private splitSentences(text: string): string[] {
    // 以句號、問號、驚嘆號、換行分割；保留非空字串
    return text
      .split(/[。！？!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * 判斷兩個句子是否相似（簡單比較：去除空白後相同）
   */
  private isSimilar(a: string, b: string): boolean {
    const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    return normalize(a) === normalize(b);
  }

  /**
   * 取得 chunk 統計資訊
   */
  getChunkStats(sessionId: string): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 };
    }

    const chunks = session.chunks;
    return {
      total: chunks.length,
      pending: chunks.filter((c) => c.status === 'pending').length,
      processing: chunks.filter((c) => c.status === 'processing').length,
      completed: chunks.filter((c) => c.status === 'completed').length,
      failed: chunks.filter((c) => c.status === 'failed').length,
    };
  }

  /**
   * 取得所有 session 列表
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 刪除 session
   */
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}
