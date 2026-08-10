import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { EmailService } from './email.service';
import { SettingsService } from '../config/settings.service';

@Controller('email')
export class EmailController {
  constructor(
    private readonly email: EmailService,
    private readonly settings: SettingsService,
  ) {}

  @Post('test')
  async test(): Promise<{ message: string }> {
    try {
      const message = await this.email.sendTestEmail(this.settings.get());
      return { message };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
