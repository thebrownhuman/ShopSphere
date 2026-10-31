import { Injectable } from '@nestjs/common';
import { Env } from './env.schema';

@Injectable()
export class AppConfig {
  constructor(private readonly env: Env) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }
}
