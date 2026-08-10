import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { PairingInfo, PairingStatus } from './auth.service';
import { PairParamsDto } from '../api/dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('status')
  status(): { paired: boolean; email: string | null } {
    return this.auth.status;
  }

  @Post('pair')
  async pair(): Promise<PairingInfo> {
    try {
      return await this.auth.startPairing();
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Get('pair/:pairingId')
  pairStatus(@Param() params: PairParamsDto): PairingStatus {
    return this.auth.getPairingStatus(params.pairingId);
  }
}
