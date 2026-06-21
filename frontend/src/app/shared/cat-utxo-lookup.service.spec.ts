import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { hex } from '@scure/base';

import { ApiService } from './cat21-api/api/api.service';
import { CatUtxoLookupService } from './cat-utxo-lookup.service';
import {
  OrdAddressResponse,
  OrdApiService,
  OrdInscriptionResponse,
  OrdOutputResponse,
} from './ord-api.service';

describe('CatUtxoLookupService', () => {
  let service: CatUtxoLookupService;
  let ordApi: { getAddress: jest.Mock; getInscription: jest.Mock; getOutput: jest.Mock };
  let cat21Api: { catsControllerGetCatByNumber: jest.Mock };
  let http: { get: jest.Mock };

  beforeEach(() => {
    ordApi = {
      getAddress: jest.fn(),
      getInscription: jest.fn(),
      getOutput: jest.fn(),
    };
    cat21Api = {
      catsControllerGetCatByNumber: jest.fn(),
    };
    http = { get: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        CatUtxoLookupService,
        { provide: OrdApiService, useValue: ordApi },
        { provide: ApiService, useValue: cat21Api },
        { provide: HttpClient, useValue: http },
      ],
    });
    service = TestBed.inject(CatUtxoLookupService);
  });

  describe('getMyHoldings', () => {
    it('returns an empty list when ord reports no cats at the address', async () => {
      ordApi.getAddress.mockReturnValue(of<OrdAddressResponse>({
        outputs: [],
        cats: [],
        cat_numbers: [],
        sat_balance: 0,
      }));
      const result = await firstValueFrom(service.getMyHoldings('bc1pSeller'));
      expect(result).toEqual([]);
    });

    it('expands each cat into a Cat21Holding via the inscription endpoint', async () => {
      const txid = 'a'.repeat(64);
      const inscriptionId = `${txid}i0`;
      ordApi.getAddress.mockReturnValue(of<OrdAddressResponse>({
        outputs: [`${txid}:0`],
        cats: [inscriptionId],
        cat_numbers: [42],
        sat_balance: 546,
      }));
      ordApi.getInscription.mockReturnValue(of<OrdInscriptionResponse>({
        id: inscriptionId,
        number: 42,
        address: 'bc1pSeller',
        satpoint: `${txid}:0:0`,
        sat: 1234567890,
      }));

      const result = await firstValueFrom(service.getMyHoldings('bc1pSeller'));
      expect(result).toEqual([
        {
          catNumber: 42,
          txid,
          vout: 0,
          value: 546,
          inscriptionId,
        },
      ]);
    });

    it('parses satpoints correctly when the offset is non-zero (treats outpoint regardless)', async () => {
      const txid = 'b'.repeat(64);
      const inscriptionId = `${txid}i0`;
      ordApi.getAddress.mockReturnValue(of<OrdAddressResponse>({
        outputs: [`${txid}:1`],
        cats: [inscriptionId],
        cat_numbers: [7],
        sat_balance: 546,
      }));
      ordApi.getInscription.mockReturnValue(of<OrdInscriptionResponse>({
        id: inscriptionId,
        number: 7,
        address: 'bc1pSeller',
        // Non-zero offset; the SDK doesn't carry offset on Cat21Holding
        // (CAT-21 always sits at sat 0 by FIFO), so we just extract
        // txid:vout regardless of what the offset says.
        satpoint: `${txid}:1:546`,
        sat: 9876543210,
      }));

      const result = await firstValueFrom(service.getMyHoldings('bc1pSeller'));
      expect(result[0]).toEqual(
        expect.objectContaining({ txid, vout: 1, value: 546 }),
      );
    });

    it('drops a cat whose satpoint cannot be parsed (does not poison the whole list)', async () => {
      const cleanTxid = 'c'.repeat(64);
      const cleanInscription = `${cleanTxid}i0`;
      const brokenInscription = `${'d'.repeat(64)}i0`;

      ordApi.getAddress.mockReturnValue(of<OrdAddressResponse>({
        outputs: [],
        cats: [cleanInscription, brokenInscription],
        cat_numbers: [1, 2],
        sat_balance: 1092,
      }));
      ordApi.getInscription.mockImplementation((id: unknown) => {
        if (id === cleanInscription) {
          return of<OrdInscriptionResponse>({
            id: cleanInscription,
            number: 1,
            address: 'bc1pSeller',
            satpoint: `${cleanTxid}:0:0`,
            sat: 100,
          });
        }
        return of<OrdInscriptionResponse>({
          id: brokenInscription,
          number: 2,
          address: 'bc1pSeller',
          satpoint: 'this-is-not-a-valid-satpoint',
          sat: 200,
        });
      });

      const result = await firstValueFrom(service.getMyHoldings('bc1pSeller'));
      expect(result).toEqual([
        expect.objectContaining({ catNumber: 1, txid: cleanTxid }),
      ]);
    });
  });

  describe('getTargetByNumber', () => {
    function setupHappyPath(catNumber: number) {
      const mintTxHash = 'e'.repeat(64);
      const currentTxid = 'f'.repeat(64);
      const inscriptionId = `${mintTxHash}i0`;
      const scriptHex = '5120' + 'a'.repeat(64);
      cat21Api.catsControllerGetCatByNumber.mockReturnValue(of({ txHash: mintTxHash }));
      ordApi.getInscription.mockReturnValue(of<OrdInscriptionResponse>({
        id: inscriptionId,
        number: catNumber,
        address: 'bc1pSellerCurrent',
        satpoint: `${currentTxid}:0:0`,
        sat: 100,
      }));
      ordApi.getOutput.mockReturnValue(of<OrdOutputResponse>({
        outpoint: `${currentTxid}:0`,
        address: 'bc1pSellerCurrent',
        script_pubkey: scriptHex,
        cats: [inscriptionId],
        sat_ranges: [[100, 646]],
      }));
      http.get.mockReturnValue(of({
        txid: currentTxid,
        vout: [
          { scriptpubkey: scriptHex, scriptpubkey_address: 'bc1pSellerCurrent', value: 546 },
        ],
      }));
      return { mintTxHash, currentTxid, inscriptionId, scriptHex };
    }

    it('resolves all four sources into a BuyOfferTargetCat when ord + esplora agree', async () => {
      const { currentTxid, scriptHex } = setupHappyPath(42);
      const result = await firstValueFrom(service.getTargetByNumber(42));
      expect(result).not.toBeNull();
      expect(result!.target.catNumber).toBe(42);
      expect(result!.target.txid).toBe(currentTxid);
      expect(result!.target.vout).toBe(0);
      expect(result!.target.value).toBe(546);
      expect(result!.target.scriptPubKey).toEqual(hex.decode(scriptHex));
      expect(result!.sellerAddress).toBe('bc1pSellerCurrent');
    });

    it('fails closed when esplora reports a different scriptPubKey than ord (oracle disagreement — audit C1)', async () => {
      const { currentTxid } = setupHappyPath(42);
      http.get.mockReturnValue(of({
        txid: currentTxid,
        vout: [
          // ord said `5120` + 64 a's; we lie via esplora to simulate ord-side poisoning.
          { scriptpubkey: '0014' + 'b'.repeat(40), scriptpubkey_address: 'bc1pSellerCurrent', value: 546 },
        ],
      }));
      const result = await firstValueFrom(service.getTargetByNumber(42));
      expect(result).toBeNull();
    });

    it('fails closed when esplora reports a different owning address than ord (oracle disagreement — audit C1)', async () => {
      const { currentTxid, scriptHex } = setupHappyPath(42);
      http.get.mockReturnValue(of({
        txid: currentTxid,
        vout: [
          { scriptpubkey: scriptHex, scriptpubkey_address: 'bc1pAttacker', value: 546 },
        ],
      }));
      const result = await firstValueFrom(service.getTargetByNumber(42));
      expect(result).toBeNull();
    });

    it('accepts when esplora omits scriptpubkey_address (non-standard script) but scriptPubKey matches', async () => {
      const { currentTxid, scriptHex } = setupHappyPath(42);
      http.get.mockReturnValue(of({
        txid: currentTxid,
        vout: [
          { scriptpubkey: scriptHex, value: 546 }, // no scriptpubkey_address
        ],
      }));
      const result = await firstValueFrom(service.getTargetByNumber(42));
      expect(result).not.toBeNull();
    });

    it('returns null when ord reports no current address (cat is at OP_RETURN / lost)', async () => {
      cat21Api.catsControllerGetCatByNumber.mockReturnValue(of({ txHash: 'a'.repeat(64) }));
      ordApi.getInscription.mockReturnValue(of<OrdInscriptionResponse>({
        id: `${'a'.repeat(64)}i0`,
        number: 5,
        address: null,
        satpoint: `${'b'.repeat(64)}:0:0`,
        sat: 1,
      }));
      const result = await firstValueFrom(service.getTargetByNumber(5));
      expect(result).toBeNull();
    });

    it('returns null when the output endpoint omits script_pubkey', async () => {
      const { currentTxid } = setupHappyPath(5);
      ordApi.getOutput.mockReturnValue(of<OrdOutputResponse>({
        outpoint: `${currentTxid}:0`,
        address: 'bc1pSellerCurrent',
        script_pubkey: '',
        cats: [],
        sat_ranges: [],
      }));
      const result = await firstValueFrom(service.getTargetByNumber(5));
      expect(result).toBeNull();
    });

    it('returns null when esplora has no vout at the index ord pointed at', async () => {
      setupHappyPath(5);
      http.get.mockReturnValue(of({ txid: 'f'.repeat(64), vout: [] }));
      const result = await firstValueFrom(service.getTargetByNumber(5));
      expect(result).toBeNull();
    });

    it('propagates indexer errors (cat number not found)', async () => {
      cat21Api.catsControllerGetCatByNumber.mockReturnValue(throwError(() => new Error('404')));
      await expect(firstValueFrom(service.getTargetByNumber(99999))).rejects.toThrow('404');
    });
  });
});
