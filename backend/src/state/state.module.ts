import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { StateService } from './state.service';

@Global()
@Module({
  providers: [DbService, StateService],
  exports: [DbService, StateService],
})
export class StateModule {}
