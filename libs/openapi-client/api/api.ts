export * from './api.service';
import { ApiService } from './api.service';
export * from './testnetApi.service';
import { TestnetApiService } from './testnetApi.service';
export const APIS = [ApiService, TestnetApiService];
