import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Logger,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiConsumes, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';

import { MintTransactionEntitiesService } from '../database-entities/mint-transaction.entities.service';
import { WhitelistEntitiesService } from '../database-entities/whitelist.entities.service';
import { tenSeconds } from '../types/constants';
import { MintTransaction } from '../types/mint-transaction';
import { WhitelistStatusResult } from '../types/whitelist-status-result';


export const schedule = {
  'Developer': {
    start: '2024-03-28T00:00Z',
    maxMintAmount: 15
  },
  'Airdrop': {
    start: '2024-04-10T16:00Z',
    maxMintAmount: 15
  },
  'Super Premint': {
    start: '2024-04-10T16:00Z',
    maxMintAmount: 15
  },
  Premint: {
    start: '2024-04-10T17:00Z',
    maxMintAmount: 10
  },
  Public: {
    start: '2024-04-10T18:00Z',
  }
}

@ApiTags('whitelist')
@Controller()
export class WhitelistController {

  constructor(
    private whitelistEntitiesService: WhitelistEntitiesService,
    private mintTransactionEntitiesService: MintTransactionEntitiesService,
    private configService: ConfigService) {
  }

  /**
   * Friendly whitelist - provides information if a wallet address is eligible to mint
   *
   * The whitelist levels are:
   * - Airdrop - one free cat delivered by us, no action required
   * - Super Premint - up to 15 cats can be minted two hours earlier, Aidrop level can also mint 15 cats at this time
   * - Premint - up to 10 cats can be minted one hour earlier
   * - Public - everyone can mint without any restrictions
   */
  @Get(['whitelist/status/:walletAddress'])
  @ApiOperation({ operationId: 'whitelistStatus' })
  @Header('Cache-Control', 'public, max-age=' + tenSeconds + ', immutable')
  async getStatus(@Param('walletAddress') walletAddress: string): Promise<WhitelistStatusResult> {

    const now = new Date();
    if (now >= new Date(schedule.Public.start)) {

      return {
        walletAddress,
        level: 'Public',
        mintingAllowed: true,
        mintingAllowedAt: schedule.Public.start
      };
    }

    const user = await this.whitelistEntitiesService.findOne(walletAddress);
    const mintCount = user ? await this.mintTransactionEntitiesService.countByRecipientAddress(walletAddress) : 0;



    let mintingAllowed = false;
    let mintingAllowedAt = schedule.Public.start;
    let maxMintAmount = 0;

    if (user) {

      maxMintAmount = schedule[user.level].maxMintAmount;
      mintingAllowedAt = schedule[user.level].start;
      mintingAllowed = mintCount < maxMintAmount && now >= new Date(mintingAllowedAt);
    }

    return {
      walletAddress,
      level: user ? user.level : 'Public',
      mintingAllowed,
      mintingAllowedAt
    };
  }

  /**
   * Friendly mint announcement
   *
   * This method saves all transactions during the premint phase, so that we can update the status
   * We will also have great live stats so that we don't have to search in the mempool
   */
  @Post('whitelist/announceMintTransaction')
  @ApiOperation({ operationId: 'announceMintTransaction' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async announceMintTransaction(@Body() mintTransaction: MintTransaction) {

    // TODO: verify signed txn, so that nobody can block other people by submitting faked txns!
    return this.mintTransactionEntitiesService.save([mintTransaction]);
  }

  /**
   * Saving WL addresses for Airdrop Level - not visible in PROD
   */
  @Post('whitelist/save/airdrop')
  @ApiBody({
    type: String,
    description: 'List of addresses',
  })
  @ApiConsumes('text/plain')
  @ApiOperation({ operationId: 'saveAirdrop' })
  @ApiExcludeEndpoint(process.env.NODE_ENV !== 'development')
  async saveAirdrop(@Req() req: RawBodyRequest<Request>) {
    const addresses = req.rawBody.toString();
    return this.saveList(addresses, 'Airdrop');
  }

  /**
   * Saving WL addresses for Super Premit Level - not visible in PROD
   */
  @Post('whitelist/save/super-premint')
  @ApiBody({
    type: String,
    description: 'List of addresses',
  })
  @ApiConsumes('text/plain')
  @ApiOperation({ operationId: 'saveSuperPremint' })
  @ApiExcludeEndpoint(process.env.NODE_ENV !== 'development')
  async saveSuperPremint(@Req() req: RawBodyRequest<Request>) {
    const addresses = req.rawBody.toString();
    return this.saveList(addresses, 'Super Premint');
  }

  /**
   * Saving WL addresses for Premint Level - not visible in PROD
   */
  @Post('whitelist/save/premint')
  @ApiBody({
    type: String,
    description: 'List of addresses',
  })
  @ApiConsumes('text/plain')
  @ApiOperation({ operationId: 'savePremint' })
  @ApiExcludeEndpoint(process.env.NODE_ENV !== 'development')
  async savePreming(@Req() req: RawBodyRequest<Request>) {
    const addresses = req.rawBody.toString();
    return this.saveList(addresses, 'Premint');
  }

  /**
   * Saving WL addresses for Developer Level - not visible in PROD
   */
  @Post('whitelist/save/developer')
  @ApiBody({
    type: String,
    description: 'List of addresses',
  })
  @ApiConsumes('text/plain')
  @ApiOperation({ operationId: 'saveDeveloper' })
  @ApiExcludeEndpoint(process.env.NODE_ENV !== 'development')
  async saveDeveloper(@Req() req: RawBodyRequest<Request>) {
    const addresses = req.rawBody.toString();
    return this.saveList(addresses, 'Developer');
  }

  private saveList(addresses: string, level: 'Airdrop' | 'Super Premint' | 'Premint' | 'Developer') {

    if (this.configService.get('environment') !== 'development') {
      throw new ForbiddenException('This method should not be called on production');
    }

    const addressesList = addresses.split('\n').filter(line => line.trim());

    const uniqueAddresses = new Set<string>();
    const duplicates = [];

    addressesList.forEach(address => {
      if (uniqueAddresses.has(address)) {
        duplicates.push(address);
      } else {
        uniqueAddresses.add(address);
      }
    });

    // Log duplicates
    if (duplicates.length > 0) {
      Logger.verbose('Duplicate entries:', duplicates);
    }

    // Convert the Set back to an array if needed
    const cleanAddressesList = Array.from(uniqueAddresses);

    const entities = cleanAddressesList.map(address => ({
      walletAddress: address,
      level,
      name: level + ' imported ' + (new Date()).toISOString(),
    }));
    return this.whitelistEntitiesService.upsert(entities);
  }
}
