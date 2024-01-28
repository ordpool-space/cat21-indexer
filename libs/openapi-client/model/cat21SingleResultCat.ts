/**
 * 🟧 CAT-21 Indexer API
 * Meow! Rescue the cats!
 *
 * The version of the OpenAPI document: 1.0
 * 
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */


/**
 * The requested cat
 */
export interface Cat21SingleResultCat { 
    /**
     * The transactionId (hash in hex format) where the CAT-21 asset was created / minted
     */
    transactionId: string;
    /**
     * The blockId (hash in hex format) where the CAT-21 asset was created / minted
     */
    blockId: string;
    /**
     * The incremented number of the cat. Cat #0 is the first one.
     */
    number: number;
    /**
     * Just for information: The block height where the CAT-21 asset was created / minted
     */
    blockHeight: number;
    /**
     * Just for information: The block time where the CAT-21 asset was created / minted (Unit: seconds)
     */
    blockTime: number;
    /**
     * Just for information: Total fees paid to process the mint transaction (Unit: sats)
     */
    fee: number;
    /**
     * Just for information: Total size of the mint transaction (Unit: bytes)
     */
    size: number;
    /**
     * Just for information: Weight of the mint transaction, which is a measurement to compare the size of different transactions to each other in proportion to the block size limit (Unit: WU)
     */
    weight: number;
    /**
     * Just for information: Value of the first output of the mint transaction (Unit: sats)
     */
    value: number;
    /**
     * The satoshi that is associated with the cat
     */
    sat: number;
    /**
     * The first cat owner (Address that received the first output of the mint transaction)
     */
    firstOwner: string;
}

