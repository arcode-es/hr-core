import { Global, Module } from '@nestjs/common';
import { DigestService } from './digest.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService, DigestService], exports: [NotificationsService, DigestService] })
export class NotificationsModule {}
