import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AbsencesController } from './absences/absences.controller';
import { AbsencesService } from './absences/absences.service';
import { HolidaysProvider, NagerHolidaysProvider } from './absences/holidays.provider';
import { HolidaysService } from './absences/holidays.service';
import { AccountController } from './account/account.controller';
import { AlertsController } from './alerts/alerts.controller';
import { AlertsService } from './alerts/alerts.service';
import { AuthModule } from './auth/auth.module';
import { type Env, validateEnv } from './config/env';
import { DashboardController } from './dashboard/dashboard.controller';
import { DocumentsController } from './documents/documents.controller';
import { DocumentJobsService } from './documents/document-jobs.service';
import { DocumentsService } from './documents/documents.service';
import { PayrollService } from './documents/payroll.service';
import { ExpensesController } from './expenses/expenses.controller';
import { ExpensesService } from './expenses/expenses.service';
import { GeoController } from './geo/geo.controller';
import { GeoService } from './geo/geo.service';
import { DemoService } from './demo/demo.service';
import { DeploymentModule } from './deployment/deployment.module';
import { InstallService } from './install/install.service';
import { JobsModule } from './jobs/jobs.module';
import { KioskController } from './kiosk/kiosk.controller';
import { KioskService } from './kiosk/kiosk.service';
import { HealthController } from './health/health.controller';
import { MetaController } from './health/meta.controller';
import { LocationsController } from './locations/locations.controller';
import { LocationsService } from './locations/locations.service';
import { OrganizationsController } from './organizations/organizations.controller';
import { DepartmentsService } from './organizations/departments.service';
import { OrganizationsService } from './organizations/organizations.service';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OcrModule } from './ocr/ocr.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScopeModule } from './common/scope.service';
import { PrivacyController } from './privacy/privacy.controller';
import { PrivacyService } from './privacy/privacy.service';
import { ReportsController } from './reports/reports.controller';
import { ManagementReportsService } from './reports/management.service';
import { ReportsService } from './reports/reports.service';
import { ShiftPatternsController } from './shifts/patterns.controller';
import { ShiftPatternsService } from './shifts/patterns.service';
import { ShiftsController } from './shifts/shifts.controller';
import { ShiftsService } from './shifts/shifts.service';
import { StorageModule } from './storage/storage.module';
import { CorrectionsService } from './time/corrections.service';
import { HoursService } from './time/hours.service';
import { TimeController } from './time/time.controller';
import { TimeService } from './time/time.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [{ ttl: 60_000, limit: config.get('RATE_LIMIT_PER_MINUTE', { infer: true }) }],
    }),
    DeploymentModule,
    PrismaModule,
    ScopeModule,
    JobsModule,
    StorageModule,
    OcrModule,
    NotificationsModule,
    MailModule,
    AuthModule,
    JwtModule.register({}),
  ],
  controllers: [HealthController, MetaController, AccountController, OrganizationsController, LocationsController, GeoController, TimeController, ShiftsController, ExpensesController, DocumentsController, ReportsController, DashboardController, PrivacyController, AbsencesController, KioskController, AlertsController, ShiftPatternsController],
  providers: [OrganizationsService, DepartmentsService, LocationsService, GeoService, TimeService, CorrectionsService, ShiftsService, ShiftPatternsService, HoursService, ExpensesService, DocumentsService, DocumentJobsService, PayrollService, ReportsService, ManagementReportsService, DemoService, InstallService, PrivacyService, AbsencesService, HolidaysService, KioskService, AlertsService, { provide: HolidaysProvider, useClass: NagerHolidaysProvider }, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
