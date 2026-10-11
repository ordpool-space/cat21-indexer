export * from './api.service';
import { ApiService } from './api.service';
export * from './bids.service';
import { BidsService } from './bids.service';
export * from './listings.service';
import { ListingsService } from './listings.service';
export const APIS = [ApiService, BidsService, ListingsService];
