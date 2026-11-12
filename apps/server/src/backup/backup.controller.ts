import { Controller, Get, Inject, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { API_ERROR_CODES, type BackupFileDto, type RestoreResultDto } from '@home-stock/shared';
import { ApiException } from '../common/api.exception';
import { BackupService } from './backup.service';

/** 上传体积上限默认值（家庭库远小于此值；防止一次性把超大文件读进内存） */
const DEFAULT_MAX_UPLOAD_BYTES = 128 * 1024 * 1024;

/**
 * 上传上限：可用 BACKUP_MAX_UPLOAD_BYTES 覆盖（测试把上限调小以免真的分配 128MB）。
 * 通过 getter 求值，让 env 在应用装配时才被读取，而不是模块加载那一刻。
 */
function resolveMaxUploadBytes(): number {
  const raw = Number(process.env.BACKUP_MAX_UPLOAD_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_UPLOAD_BYTES;
}

interface UploadedBackupFile {
  buffer?: Buffer;
  size?: number;
}

/**
 * 备份与恢复 API（M8）：
 * GET  /api/backup          下载一致性快照（attachment）
 * GET  /api/backup/list     备份目录列表
 * POST /api/backup/restore  上传恢复（multipart，字段名 file）
 *
 * 超限上传由 multer 直接返回 413（不会进入恢复逻辑，也就不会产生 pre-restore 安全备份）。
 */
@Controller('api/backup')
export class BackupController {
  constructor(@Inject(BackupService) private readonly backups: BackupService) {}

  @Get()
  async download(@Res() res: Response): Promise<void> {
    const { path, filename } = await this.backups.createDownload();
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(path, (err) => {
      this.backups.cleanupDownload(path);
      if (err && !res.headersSent) {
        res.status(500).json({ code: API_ERROR_CODES.INTERNAL_ERROR, message: '备份下载失败' });
      }
    });
  }

  @Get('list')
  list(): { data: BackupFileDto[] } {
    return { data: this.backups.list() };
  }

  @Post('restore')
  @UseInterceptors(
    FileInterceptor('file', {
      get limits(): { fileSize: number } {
        return { fileSize: resolveMaxUploadBytes() };
      },
    }),
  )
  async restore(@UploadedFile() file?: UploadedBackupFile): Promise<{ data: RestoreResultDto }> {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new ApiException(400, API_ERROR_CODES.VALIDATION_ERROR, '请上传备份文件');
    }
    return { data: await this.backups.restore(file.buffer) };
  }
}
