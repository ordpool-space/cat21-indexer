import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class UtxosValidationPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {

    const validationError = this.getValidationError(value);
    if (validationError) {
      throw new BadRequestException(validationError);
    }
    return value;
  }

  private getValidationError(utxos: any): string | null {
    if (!Array.isArray(utxos)) {
      return 'UTXOs must be an array.';
    }
    if (utxos.length > 100) {
      return 'The number of UTXOs cannot exceed 100.';
    }
    const utxoRegex = /^[a-fA-F0-9]+:[0-9]+$/;
    for (const utxo of utxos) {
      if (typeof utxo !== 'string') {
        return 'Each UTXO must be a string.';
      }
      if (!utxoRegex.test(utxo)) {
        return `UTXO '${utxo}' is not in the correct format (transactionId:number).`;
      }
    }
    return null; // No validation errors
  }
}
