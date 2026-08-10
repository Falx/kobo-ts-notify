import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsService } from './settings.service';
import type { AppSettings } from './app-settings';
import { UpdateSettingsDto } from '../api/dto';
import { SECRET_KEYS } from './app-settings';

export interface SettingsDto {
  [key: string]: unknown;
  secretsSet: Record<string, boolean>;
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(): SettingsDto {
    return this.settings.getPublic() as unknown as SettingsDto;
  }

  @Put()
  update(@Body() dto: UpdateSettingsDto): SettingsDto {
    const patch: Partial<AppSettings> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      // An empty secret means "leave the stored value alone".
      if (SECRET_KEYS.has(key as keyof AppSettings) && value === '') continue;
      (patch as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(patch).length === 0) {
      return this.settings.getPublic() as unknown as SettingsDto;
    }
    this.settings.update(patch);
    return this.settings.getPublic() as unknown as SettingsDto;
  }
}
