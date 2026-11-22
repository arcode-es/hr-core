import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CustomCategoryDto,
  ExpenseConfig,
  expenseCategorySchema,
  ExpenseDto,
  ExpenseInput,
  expenseRangeSchema,
  expenseSchema,
  ExpenseSummaryRow,
  OcrSuggestion,
  ReviewInput,
  reviewSchema,
  reimburseSchema,
} from '@hr/shared';
import type { z } from 'zod';
import { AuthUser, CurrentUser, CurrentWorkspace, Roles, WorkspaceContext } from '../common/context';
import { MAX_PHOTO_BYTES } from '../common/images';
import { ZodPipe } from '../common/zod.pipe';
import { ExpensesService } from './expenses.service';

type Range = z.infer<typeof expenseRangeSchema>;
const Receipt = () => UseInterceptors(FileInterceptor('receipt', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }));

/** multipart/form-data: `data` con el JSON del gasto y, opcionalmente, `receipt` con la foto. */
function parse(data: string): ExpenseInput {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw new BadRequestException({ code: 'VALIDATION' });
  }
  return new ZodPipe(expenseSchema).transform(json);
}

@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('config')
  config(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<ExpenseConfig> {
    return this.expenses.config(user.id, ws);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(expenseRangeSchema)) q: Range): Promise<ExpenseDto[]> {
    return this.expenses.list(user.id, ws, q.from, q.to);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(expenseRangeSchema)) q: Range,
  ): Promise<ExpenseSummaryRow[]> {
    return this.expenses.summary(user.id, ws, q.from, q.to);
  }

  @Get('pending')
  @Roles('ADMIN', 'MANAGER')
  pending(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext): Promise<ExpenseDto[]> {
    return this.expenses.pending(user.id, ws);
  }

  @Get('team')
  @Roles('ADMIN', 'MANAGER', 'INSPECTOR')
  team(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Query(new ZodPipe(expenseRangeSchema)) q: Range): Promise<ExpenseDto[]> {
    return this.expenses.team(user.id, ws, q.from, q.to);
  }

  @Post('ocr')
  @HttpCode(200)
  @Receipt()
  ocr(@UploadedFile() receipt?: Express.Multer.File): Promise<OcrSuggestion> {
    if (!receipt) throw new BadRequestException({ code: 'INVALID_PHOTO' });
    return this.expenses.suggest({ buffer: receipt.buffer });
  }

  @Post('reimburse')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(200)
  reimburse(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(reimburseSchema)) dto: z.infer<typeof reimburseSchema>,
  ): Promise<{ reimbursed: number; amount: number }> {
    return this.expenses.reimburse(user.id, ws, dto.userId, dto.from, dto.to);
  }

  @Post('categories')
  @Roles('ADMIN', 'MANAGER')
  createCategory(
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(expenseCategorySchema)) dto: z.infer<typeof expenseCategorySchema>,
  ): Promise<CustomCategoryDto> {
    return this.expenses.createCategory(ws, dto.name, dto.baseCategory);
  }

  @Delete('categories/:id')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(204)
  archiveCategory(@CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    // Se desactiva en lugar de borrarse: los gastos ya registrados conservan su categoría.
    return this.expenses.setCategoryActive(ws, id, false);
  }

  @Post()
  @Receipt()
  create(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body('data') data: string,
    @UploadedFile() receipt?: Express.Multer.File,
  ): Promise<ExpenseDto> {
    return this.expenses.create(user.id, ws, parse(data), receipt && { buffer: receipt.buffer });
  }

  @Patch(':id')
  @Receipt()
  update(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('data') data: string,
    @UploadedFile() receipt?: Express.Multer.File,
  ): Promise<ExpenseDto> {
    return this.expenses.update(user.id, ws, id, parse(data), receipt && { buffer: receipt.buffer });
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.expenses.remove(user.id, ws, id);
  }

  @Get(':id/receipt')
  receipt(@CurrentUser() user: AuthUser, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', ParseUUIDPipe) id: string): Promise<{ url: string }> {
    return this.expenses.receiptUrl(user.id, ws, id);
  }

  @Post(':id/review')
  @Roles('ADMIN', 'MANAGER')
  @HttpCode(200)
  review(
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(reviewSchema)) dto: ReviewInput,
  ): Promise<ExpenseDto> {
    return this.expenses.review(user.id, ws, id, dto);
  }
}
