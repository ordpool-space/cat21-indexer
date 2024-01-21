// Format:
// https://github.com/Blockstream/esplora/blob/master/API.md
/*
## Transaction format

- `txid`
- `version`
- `locktime`
- `size`
- `weight`
- `fee`
- `vin[]`
  - `txid`
  - `vout`
  - `is_coinbase`
  - `scriptsig`
  - `scriptsig_asm`
  - `inner_redeemscript_asm`
  - `inner_witnessscript_asm`
  - `sequence`
  - `witness[]`
  - `prevout` (previous output in the same format as in `vout` below)
  - *(Elements only)*
  - `is_pegin`
  - `issuance` (available for asset issuance transactions, `null` otherwise)
    - `asset_id`
    - `is_reissuance`
    - `asset_id`
    - `asset_blinding_nonce`
    - `asset_entropy`
    - `contract_hash`
    - `assetamount` or `assetamountcommitment`
    - `tokenamount` or `tokenamountcommitment`
- `vout[]`
  - `scriptpubkey`
  - `scriptpubkey_asm`
  - `scriptpubkey_type`
  - `scriptpubkey_address`
  - `value`
  - *(Elements only)*
  - `valuecommitment`
  - `asset` or `assetcommitment`
  - `pegout` (available for peg-out outputs, `null` otherwise)
    - `genesis_hash`
    - `scriptpubkey`
    - `scriptpubkey_asm`
    - `scriptpubkey_address`
- `status`
  - `confirmed` (boolean)
  - `block_height` (available for confirmed transactions, `null` otherwise)
  - `block_hash` (available for confirmed transactions, `null` otherwise)
  - `block_time` (available for confirmed transactions, `null` otherwise)
*/


// https://blockstream.info/api/tx/98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892
/*

{
  "txid":"98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892",
  "version":2,
  "locktime":21,
  "vin":[
    {
      "txid":"97b4ecfe7c015aa35f3a2e0299be09a0dc3d02c6dbcff31a23c80f806a19af9a",
      "vout":11,
      "prevout":{
        "scriptpubkey":"a914f15d0dc87fc1cd6d2395870a7c6a6788854c03ec87",
        "scriptpubkey_asm":"OP_HASH160 OP_PUSHBYTES_20 f15d0dc87fc1cd6d2395870a7c6a6788854c03ec OP_EQUAL",
        "scriptpubkey_type":"p2sh",
        "scriptpubkey_address":"3PhEFGZSE4JhMa8JPoX5rf9gUZnsDwCcJt",
        "value":634426
      },
      "scriptsig":"160014d6128ca4880dc012f901129ee3491c2d1c343b26",
      "scriptsig_asm":"OP_PUSHBYTES_22 0014d6128ca4880dc012f901129ee3491c2d1c343b26",
      "witness":[
        "3044022065051b1b6479dd36eb921894b3173a0bc3768d75bfadbd473839147580f75d8302201d0a1952da156f37f05e3b2898c52fdd18fd133a47b2d4624098510597626a7501",
        "029ad68868c3175c8e7d62e831d5dc3830837352f5f3be8bd3e1a997c78e4cbd70"
      ],
      "is_coinbase":false,
      "sequence":4294967293,
      "inner_redeemscript_asm":"OP_0 OP_PUSHBYTES_20 d6128ca4880dc012f901129ee3491c2d1c343b26"
    }
  ],
  "vout":[
    {
      "scriptpubkey":"51203d07d2d99aed4e465abb056e679dc6b697152db27149fedf23464d626e188f1d",
      "scriptpubkey_asm":"OP_PUSHNUM_1 OP_PUSHBYTES_32 3d07d2d99aed4e465abb056e679dc6b697152db27149fedf23464d626e188f1d",
      "scriptpubkey_type":"v1_p2tr",
      "scriptpubkey_address":"bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh",
      "value":546
    },
    {
      "scriptpubkey":"a9148042770d5c6df6139944e63a368228131f117c1a87",
      "scriptpubkey_asm":"OP_HASH160 OP_PUSHBYTES_20 8042770d5c6df6139944e63a368228131f117c1a OP_EQUAL",
      "scriptpubkey_type":"p2sh",
      "scriptpubkey_address":"3DPC3AqsW6eRS8J3bfwL3iS7zBSPyBYYEz",
      "value":593046
    }
  ],
  "size":258,
  "weight":705,
  "fee":40834,
  "status":{
    "confirmed":true,
    "block_height":824205,
    "block_hash":"000000000000000000018e3ea447b11385e3330348010e1b2418d0d8ae4e0ac7",
    "block_time":1704315886
  }
}
*/

export interface Transaction {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  vin: Vin[];
  vout: Vout[];
  status: Status;
}

export interface Vin {
  txid: string;
  vout: number;
  is_coinbase: boolean;
  scriptsig: string;
  scriptsig_asm: string;
  inner_redeemscript_asm?: string;
  inner_witnessscript_asm?: string;
  sequence: any;
  witness?: string[];
  prevout: Vout;
  // Elements
  is_pegin?: boolean;
  issuance?: Issuance;
}

interface Issuance {
  asset_id: string;
  is_reissuance: string;
  asset_blinding_nonce: string;
  asset_entropy: string;
  contract_hash: string;
  assetamount?: number;
  assetamountcommitment?: string;
  tokenamount?: number;
  tokenamountcommitment?: string;
}

export interface Vout {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
  // Elements
  valuecommitment?: number;
  asset?: string;
  pegout?: Pegout;
}

interface Pegout {
  genesis_hash: string;
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_address: string;
}

export interface Status {
  confirmed: boolean;
  block_height?: number;
  block_hash?: string;
  block_time?: number;
}
