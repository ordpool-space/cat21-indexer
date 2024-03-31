import { Test, TestingModule } from '@nestjs/testing';

import { MintTransactionEntitiesService } from '../database-entities/mint-transaction.entities.service';
import { WhitelistEntitiesService } from '../database-entities/whitelist.entities.service';
import { schedule, WhitelistController } from './whitelist.controller';

describe('WhitelistController Tests', () => {
  let controller: WhitelistController;
  let module: TestingModule;
  let mockWhitelistEntitiesService: Partial<WhitelistEntitiesService>;
  let mockMintTransactionEntitiesService: Partial<MintTransactionEntitiesService>;


  beforeEach(async () => {

    mockWhitelistEntitiesService = {
      findOne: jest.fn(),
    };
    mockMintTransactionEntitiesService = {
      countByRecipientAddress: jest.fn(),
    };

    module = await Test.createTestingModule({
      controllers: [WhitelistController],
      providers: [
        { provide: WhitelistEntitiesService, useValue: mockWhitelistEntitiesService },
        { provide: MintTransactionEntitiesService, useValue: mockMintTransactionEntitiesService }
      ],
    }).compile();

    controller = module.get<WhitelistController>(WhitelistController);
  });

  it('should allow public to mint after public start', async () => {

    // After public start
    jest.useFakeTimers().setSystemTime(new Date(schedule.Public.start).getTime() + 1000);
    (mockWhitelistEntitiesService.findOne as jest.Mock).mockResolvedValueOnce(null); // No whitelist entry

    const response = await controller.getStatus('non-whitelisted-address');
    expect(response).toEqual({
      walletAddress: 'non-whitelisted-address',
      level: 'Public',
      mintingAllowed: true,
      mintingAllowedAt: schedule.Public.start,
    });
  });

  it('should not allow Airdrop to mint before start', async () => {

    // Before Airdrop start
    jest.useFakeTimers().setSystemTime(new Date(schedule['Airdrop'].start).getTime() - 1000);

    (mockWhitelistEntitiesService.findOne as jest.Mock).mockResolvedValueOnce({ walletAddress: 'airdrop-address', level: 'Airdrop' });
    (mockMintTransactionEntitiesService.countByRecipientAddress as jest.Mock).mockResolvedValueOnce(0);

    const response = await controller.getStatus('airdrop-address');
    expect(response.mintingAllowed).toBe(false);
  });

  it('should allow Super Premint to mint after start', async () => {
    jest.useFakeTimers().setSystemTime(new Date(schedule['Super Premint'].start).getTime() + 1000);
    (mockWhitelistEntitiesService.findOne as jest.Mock).mockResolvedValueOnce({ walletAddress: 'super-premint-address', level: 'Super Premint' });
    (mockMintTransactionEntitiesService.countByRecipientAddress as jest.Mock).mockResolvedValueOnce(0);

    const response = await controller.getStatus('super-premint-address');
    expect(response).toEqual({
      walletAddress: 'super-premint-address',
      level: 'Super Premint',
      mintingAllowed: true,
      mintingAllowedAt: schedule['Super Premint'].start,
    });
  });

  it('should allow Premint to mint after start', async () => {
    jest.useFakeTimers().setSystemTime(new Date(schedule.Premint.start).getTime() + 1000);
    (mockWhitelistEntitiesService.findOne as jest.Mock).mockResolvedValueOnce({ walletAddress: 'premint-address', level: 'Premint' });
    (mockMintTransactionEntitiesService.countByRecipientAddress as jest.Mock).mockResolvedValueOnce(0);

    const response = await controller.getStatus('premint-address');
    expect(response).toEqual({
      walletAddress: 'premint-address',
      level: 'Premint',
      mintingAllowed: true,
      mintingAllowedAt: schedule.Premint.start,
    });
  });

  it('should not allow Airdrop to mint more than allowed', async () => {
    jest.useFakeTimers().setSystemTime(new Date(schedule['Airdrop'].start).getTime() + 1000);
    (mockWhitelistEntitiesService.findOne as jest.Mock).mockResolvedValueOnce({ walletAddress: 'airdrop-address', level: 'Airdrop' });
    (mockMintTransactionEntitiesService.countByRecipientAddress as jest.Mock).mockResolvedValueOnce(15); // Already minted 15 times

    const response = await controller.getStatus('airdrop-address');
    expect(response.mintingAllowed).toBe(false);
  });

  // Test Super Premint Level Exceeding Mint Count
  it('should not allow Super Premint to mint more than allowed', async () => {
    jest.useFakeTimers().setSystemTime(new Date(schedule['Super Premint'].start).getTime() + 1000);
    (mockWhitelistEntitiesService.findOne as jest.Mock).mockResolvedValueOnce({ walletAddress: 'super-premint-exceed', level: 'Super Premint' });
    (mockMintTransactionEntitiesService.countByRecipientAddress as jest.Mock).mockResolvedValueOnce(16); // Assuming 15 is the limit

    const response = await controller.getStatus('super-premint-exceed');
    expect(response.mintingAllowed).toBe(false);
  });

  it('should treat invalid wallet address as public after start', async () => {
    jest.useFakeTimers().setSystemTime(new Date(schedule.Public.start).getTime() + 1000);
    (mockWhitelistEntitiesService.findOne as jest.Mock).mockResolvedValueOnce(null);

    const response = await controller.getStatus('invalid-address');
    expect(response).toEqual({
      walletAddress: 'invalid-address',
      level: 'Public',
      mintingAllowed: true,
      mintingAllowedAt: schedule.Public.start,
    });
  });

  it('should not allow public minting before start', async () => {
    jest.useFakeTimers().setSystemTime(new Date(schedule.Public.start).getTime() - 1000);
    (mockWhitelistEntitiesService.findOne as jest.Mock).mockResolvedValueOnce(null);

    const response = await controller.getStatus('any-address');
    expect(response.mintingAllowed).toBe(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });
});
