import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { type EmailPrefs, emailPrefsSchema, markReadSchema, NotificationList, PushSubscriptionInput, pushSubscriptionSchema } from '@hr/shared';
import { z } from 'zod';
import { AuthUser, CurrentUser, Meta, RequestMeta, AllowReadOnly } from '../common/context';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from './notifications.service';

const endpointSchema = z.object({ endpoint: z.string().url().max(1000) });

/** Los avisos son del usuario, no de un espacio: llegan de todas sus empresas. */
@AllowReadOnly()
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() user: AuthUser): Promise<NotificationList> {
    return this.notifications.list(user.id);
  }

  @Post('notifications/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Body(new ZodPipe(markReadSchema)) dto: z.infer<typeof markReadSchema>): Promise<void> {
    return this.notifications.markRead(user.id, dto.ids);
  }

  /** Qué avisos llegan también por correo. */
  @Get('me/email-prefs')
  emailPrefs(@CurrentUser() user: AuthUser): Promise<EmailPrefs> {
    return this.notifications.emailPrefs(user.id);
  }

  @Put('me/email-prefs')
  setEmailPrefs(@CurrentUser() user: AuthUser, @Body(new ZodPipe(emailPrefsSchema)) dto: EmailPrefs): Promise<EmailPrefs> {
    return this.notifications.setEmailPrefs(user.id, dto);
  }

  /** Clave pública para suscribirse a push; null si el servidor no tiene push configurado. */
  @Get('push/key')
  key(): { publicKey: string | null } {
    return { publicKey: this.notifications.publicKey };
  }

  @Post('push/subscribe')
  @HttpCode(204)
  subscribe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(pushSubscriptionSchema)) dto: PushSubscriptionInput, @Meta() meta: RequestMeta): Promise<void> {
    return this.notifications.subscribe(user.id, dto, meta.userAgent);
  }

  @Delete('push/subscribe')
  @HttpCode(204)
  unsubscribe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(endpointSchema)) dto: z.infer<typeof endpointSchema>): Promise<void> {
    return this.notifications.unsubscribe(user.id, dto.endpoint);
  }
}
