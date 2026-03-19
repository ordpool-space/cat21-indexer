import { CatDto } from '../dto/cat.dto';

/** Genesis cat DB row shape (Date for mintedAt) */
export const GENESIS_ROW = {
  id: 'uuid-1',
  catNumber: 0,
  txHash: '98316dcb21daaa221865208fe0323616ee6dd84e6020b78bc6908e914ac03892',
  blockHash: '000000000000000000018e3ea447b11385e3330348010e1b2418d0d8ae4e0ac7',
  blockHeight: 824205,
  mintedAt: new Date('2024-01-03T21:04:46.000Z'),
  mintedBy: 'bc1p85ra9kv6a48yvk4mq4hx08wxk6t32tdjw9ylahergexkymsc3uwsdrx6sh',
  fee: 40834,
  weight: 705,
  size: 195,
  feeRate: 231.67,
  sat: 596964966600565,
  value: 546,
  category: 'sub1k',
  genesis: true,
  catColors: ['#000000'],
  male: true,
  female: false,
  designIndex: 0,
  designPose: 'Standing',
  designExpression: 'Smile',
  designPattern: 'Solid',
  designFacing: 'Left',
  laserEyes: 'Red',
  background: 'Orange',
  backgroundColors: ['#ff9900'],
  crown: 'None',
  glasses: 'None',
  glassesColors: [],
};

/** Genesis cat DTO shape (ISO string for mintedAt) */
export const GENESIS_DTO: CatDto = {
  ...GENESIS_ROW,
  mintedAt: '2024-01-03T21:04:46.000Z',
} as CatDto;
