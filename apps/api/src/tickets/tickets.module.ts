import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { TicketAlertsService } from './ticket-alerts.service';
import { NotifierService } from '../common/notifier.service';
import { PushModule } from '../push/push.module';

@Module({
  imports: [PushModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketAlertsService, NotifierService],
  exports: [TicketsService],
})
export class TicketsModule {}
