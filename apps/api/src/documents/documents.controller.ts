import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentDto, MAX_DOCUMENT_BYTES, monthSchema, type PayrollAnalysis, type PayrollSendInput, payrollSendSchema, sendDocumentSchema, SignDocumentInput, signDocumentSchema, type TimesheetsSent } from '@hr/shared';
import type { Response } from 'express';
import { AuthUser, CurrentUser, CurrentWorkspace, Meta, RequestMeta, Roles, WorkspaceContext } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { DocumentJobsService } from './document-jobs.service';
import { DocumentsService } from './documents.service';
import { PayrollService } from './payroll.service';

/** Un PDF de nóminas de toda la plantilla puede ser grande. */
const MAX_PAYROLL_BYTES = 40 * 1024 * 1024;

@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly payroll: PayrollService,
    private readonly jobs: DocumentJobsService,
  ) {}

  /** Sube el PDF con las nóminas de todos y propone a quién va cada página (por su DNI/NIE). */
  @Post('payroll')
  @Roles('ADMIN')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PAYROLL_BYTES, files: 1 } }))
  analyzePayroll(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @UploadedFile() file?: Express.Multer.File): Promise<PayrollAnalysis> {
    if (!file) throw new BadRequestException({ code: 'PAYROLL_UNREADABLE' });
    return this.payroll.analyze(user.id, ws, { buffer: file.buffer, originalName: Buffer.from(file.originalname, 'latin1').toString('utf8') });
  }

  /** Solo en la demo: PDF de nóminas de ejemplo para probar el reparto. */
  @Get('payroll/sample.pdf')
  @Roles('ADMIN')
  async payrollSample(@CurrentWorkspace() ws: WorkspaceContext, @Res() res: Response): Promise<void> {
    const pdf = await this.payroll.sample(ws);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="nominas-ejemplo.pdf"', 'Cache-Control': 'no-store' });
    res.send(pdf);
  }

  @Post('payroll/:id/send')
  @Roles('ADMIN')
  @HttpCode(200)
  sendPayroll(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(payrollSendSchema)) dto: PayrollSendInput,
  ): Promise<{ sent: number }> {
    return this.payroll.send(user.id, ws, id, dto);
  }

  @Delete('payroll/:id')
  @Roles('ADMIN')
  @HttpCode(204)
  discardPayroll(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.payroll.discard(user.id, ws, id);
  }

  /** Envía ahora el registro de jornada de un mes a quien trabajó ese mes (sin esperar al envío automático). */
  @Post('timesheets')
  @Roles('ADMIN')
  @HttpCode(200)
  sendTimesheets(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Body(new ZodPipe(monthSchema)) dto: { month: string }): Promise<TimesheetsSent> {
    return this.jobs.sendTimesheets(user.id, ws, dto.month);
  }

  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<DocumentDto[]> {
    return this.documents.inbox(user.id, ws);
  }

  @Get('sent')
  sent(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<DocumentDto[]> {
    return this.documents.sent(user.id, ws);
  }

  /** multipart/form-data: `data` con el JSON del envío y `file` con el PDF o la imagen. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  send(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body('data') data: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<DocumentDto[]> {
    if (!file) throw new BadRequestException({ code: 'INVALID_DOCUMENT' });
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION' });
    }
    // multer entrega el nombre en latin1; se recupera el UTF-8 original (acentos, eñes).
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return this.documents.send(user.id, ws, new ZodPipe(sendDocumentSchema).transform(json), { buffer: file.buffer, originalName });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<DocumentDto> {
    return this.documents.get(user.id, ws, id);
  }

  /** El archivo viaja por la API con la sesión del usuario: no hace falta exponer el almacenamiento al navegador. */
  @Get(':id/content/:which')
  async content(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('which', new ParseEnumPipe(['original', 'signed'])) which: 'original' | 'signed',
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.documents.content(user.id, ws, id, which);
    res
      .set({
        'Content-Type': file.mimeType,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(file.body);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  acknowledge(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<DocumentDto> {
    return this.documents.acknowledge(user.id, ws, id);
  }

  @Post(':id/sign')
  @HttpCode(200)
  sign(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(signDocumentSchema)) dto: SignDocumentInput,
    @Meta() meta: RequestMeta,
  ): Promise<DocumentDto> {
    return this.documents.sign(user.id, ws, id, dto, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.documents.remove(user.id, ws, id);
  }
}
