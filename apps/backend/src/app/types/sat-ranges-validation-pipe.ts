import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class SatRangesValidationPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {

    const validationError = this.getValidationError(value);
    if (validationError) {
      throw new BadRequestException(validationError);
    }
    return value;
  }

  private getValidationError(satRanges: any): string | null {
    if (!Array.isArray(satRanges)) {
      return 'Sat ranges must be an array.';
    }
    if (satRanges.length > 1000) {
      return 'The number of sat ranges cannot exceed 1000.';
    }
    for (const range of satRanges) {
      if (!Array.isArray(range) || range.length !== 2) {
        return 'Each sat range must be an array of exactly two numbers.';
      }
      if (range.some(element => typeof element !== 'number')) {
        return 'Each element in a sat range must be a number.';
      }
    }
    return null; // No validation errors
  }
}
