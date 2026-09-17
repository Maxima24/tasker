import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TasksModule } from './tasks/tasks.module';
import { TaskTypesModule } from './task-types/task-types.module';
import { TaskersModule } from './taskers/taskers.module';
import { VaultModule } from './vault/vault.module';
import { ProofModule } from './proof/proof.module';
import { TutorialsModule } from './tutorials/tutorials.module';
import { TelegramModule } from './telegram/telegram.module';
import { QueuesModule } from './queues/queues.module';
import { TicketsModule } from './tickets/tickets.module';
import { PushModule } from './push/push.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    TasksModule,
    TaskTypesModule,
    TaskersModule,
    VaultModule,
    ProofModule,
    TutorialsModule,
    TelegramModule,
    QueuesModule,
    TicketsModule,
    PushModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
